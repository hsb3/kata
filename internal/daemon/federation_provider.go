package daemon

import (
	"context"
	"errors"
	"slices"
	"strings"
	"uuid"

	"go.kenn.io/kata/internal/config"
	"go.kenn.io/kata/internal/db"
	"go.kenn.io/kata/pkg/federationprovider"
)

// AuthorizeFederationProvider saves a candidate before contacting the trusted
// helper. A ready result is retained before the caller may fetch metadata or
// bind the replica. This operation does not itself enable federation.
func AuthorizeFederationProvider(
	ctx context.Context, store db.Storage, credentials config.FederationCredentialStore,
	catalog config.CatalogDaemonConfig, mapping config.FederationProjectConfig,
) (config.FederationManagedCredentialReservation, error) {
	managed, err := managedCredentialStore(credentials)
	if err != nil {
		return config.FederationManagedCredentialReservation{}, err
	}
	reservation, err := prepareFederationProvider(ctx, store, managed, catalog, mapping)
	if err != nil {
		return reservation, err
	}
	switch reservation.Credential.Provider.Status {
	case "ready", "denied", "conflict":
		return reservation, nil
	}
	finish, err := BeginFederationReplicaHubOperation(ctx, store, managed, mapping.SpokeProject, reservation)
	if err != nil {
		return reservation, err
	}
	result, exchangeErr := exchangeFederationProvider(ctx, managed, reservation)
	// Release uses the saved request ID, never a response-supplied enrollment
	// ID. The existing drain still prevents leave from deleting in-flight state.
	leavePending, finishErr := finish(ctx, 0)
	if finishErr != nil {
		return reservation, finishErr
	}
	if leavePending {
		return reservation, ErrFederationReplicaLeavePending
	}
	return result, exchangeErr
}

func prepareFederationProvider(
	ctx context.Context, store db.Storage, managed config.FederationManagedCredentialStore,
	catalog config.CatalogDaemonConfig, mapping config.FederationProjectConfig,
) (config.FederationManagedCredentialReservation, error) {
	var empty config.FederationManagedCredentialReservation
	if len(mapping.CredentialProvider) == 0 || mapping.Hub != catalog.Name || catalog.Local ||
		config.ValidateFederationAuthentication(mapping, catalog) != nil ||
		config.ValidateProjectName(mapping.SpokeProject) != nil || config.ValidateProjectName(mapping.HubProject) != nil {
		return empty, ErrFederationReplicaInvalidInput
	}
	base, err := config.CanonicalHTTPBaseURL(catalog.URL)
	if err != nil {
		return empty, ErrFederationReplicaInvalidInput
	}
	ensureFederationReplicaMu.Lock()
	defer ensureFederationReplicaMu.Unlock()
	if err := federationReplicaTransitions.leaveBlockedError(federationReplicaTransitionKey(store, mapping.SpokeProject)); err != nil {
		return empty, err
	}
	project, err := store.ProjectByName(ctx, mapping.SpokeProject)
	if err != nil {
		return empty, err
	}
	previous, found, err := managed.FindManagedFederationCredential(ctx, mapping.SpokeProject)
	if err != nil {
		return empty, err
	}
	if found {
		return matchFederationProvider(previous, project, store.InstanceUID(), base, catalog, mapping)
	}
	if _, found, err := managed.FederationCredential(ctx, project.UID); err != nil {
		return empty, err
	} else if found {
		return empty, ErrFederationReplicaCredentialConflict
	}
	if _, err := store.FederationBindingByProject(ctx, project.ID); !errors.Is(err, db.ErrNotFound) {
		if err != nil {
			return empty, err
		}
		return empty, ErrFederationReplicaBindingConflict
	}
	token, err := db.NewFederationToken()
	if err != nil {
		return empty, err
	}
	reservation := config.FederationManagedCredentialReservation{ProjectUID: project.UID, Credential: config.FederationCredential{
		HubURL: base, Token: token, ManagedByConfig: true,
		HubCatalog: catalog.Name, HubProjectName: mapping.HubProject, SpokeProjectName: mapping.SpokeProject,
		Provider: &config.FederationProviderCredential{
			RequestID: uuid.New(), Command: slices.Clone(mapping.CredentialProvider), Intent: mapping.Intent,
			SpokeInstanceUID: store.InstanceUID(), LocalProjectUID: project.UID,
		},
	}}
	if err := managed.ReserveManagedFederationCredential(ctx, reservation); err != nil {
		return empty, err
	}
	return reservation, nil
}

func matchFederationProvider(
	reservation config.FederationManagedCredentialReservation, project db.Project,
	instance, base string, catalog config.CatalogDaemonConfig, mapping config.FederationProjectConfig,
) (config.FederationManagedCredentialReservation, error) {
	c := reservation.Credential
	p := c.Provider
	if p == nil || c.HubURL != base || c.HubCatalog != catalog.Name || c.HubProjectName != mapping.HubProject ||
		c.SpokeProjectName != mapping.SpokeProject || p.Intent != mapping.Intent || p.SpokeInstanceUID != instance ||
		!slices.Equal(p.Command, mapping.CredentialProvider) ||
		(project.UID != p.LocalProjectUID && project.UID != p.HubProjectUID) ||
		(reservation.ProjectUID != p.LocalProjectUID && reservation.ProjectUID != p.HubProjectUID) {
		return reservation, ErrFederationReplicaCredentialConflict
	}
	if c.LeavePending || p.Status == "released" {
		return reservation, ErrFederationReplicaLeavePending
	}
	return reservation, nil
}

func exchangeFederationProvider(
	ctx context.Context, managed config.FederationManagedCredentialStore,
	reservation config.FederationManagedCredentialReservation,
) (config.FederationManagedCredentialReservation, error) {
	c := reservation.Credential
	p := c.Provider
	request := federationprovider.Request{
		Version: 1, Operation: "authorize", RequestID: p.RequestID,
		HubURL: c.HubURL, Project: c.HubProjectName, SpokeInstanceUID: p.SpokeInstanceUID,
		LocalProjectUID: p.LocalProjectUID, Intent: p.Intent, CandidateToken: c.Token,
	}
	response, err := federationprovider.Exchange(ctx, p.Command, request)
	if err != nil {
		return reservation, err
	}
	replacement := reservation
	next := *p
	next.Status = response.Status
	replacement.Credential.Provider = &next
	if response.Status == "ready" {
		response.Actor = strings.TrimSpace(response.Actor)
		if db.ValidateTokenActor(response.Actor) != nil {
			return reservation, federationprovider.ErrInvalidResponse
		}
		replacement.Credential.HubProjectID = response.ProjectID
		replacement.Credential.Actor = response.Actor
		replacement.Credential.Capabilities = response.Capabilities
		next.HubProjectUID = response.ProjectUID
		next.EnrollmentID = response.EnrollmentID
		next.ExpiresAt = response.ExpiresAt
	}
	// This exact replacement also refuses an intervening leave marker. Keeping
	// the earlier candidate is sufficient to release even if this write fails.
	if err := managed.ReplaceManagedFederationCredential(ctx, reservation, replacement); err != nil {
		return reservation, err
	}
	return replacement, nil
}

// ReleaseFederationProvider fences local provider work before requesting exact
// release. It retains the credential and request until confirmed, including
// when the helper is offline. The caller may detach after status released.
func ReleaseFederationProvider(
	ctx context.Context, store db.Storage, credentials config.FederationCredentialStore, projectID int64,
) (config.FederationManagedCredentialReservation, error) {
	managed, err := managedCredentialStore(credentials)
	if err != nil {
		return config.FederationManagedCredentialReservation{}, err
	}
	project, err := store.ProjectByID(ctx, projectID)
	if err != nil {
		return config.FederationManagedCredentialReservation{}, err
	}
	previous, found, err := managed.FindManagedFederationCredential(ctx, project.Name)
	if err != nil {
		return previous, err
	}
	if !found || previous.Credential.Provider == nil {
		return previous, ErrFederationReplicaCredentialConflict
	}
	prepared, err := PrepareFederationReplicaLeave(ctx, store, managed, projectID)
	if err != nil {
		return previous, err
	}
	reservation := prepared.ManagedReservation
	p := reservation.Credential.Provider
	if !prepared.ManagedReservationFound || p == nil || p.RequestID != previous.Credential.Provider.RequestID {
		return previous, ErrFederationReplicaCredentialConflict
	}
	if p.Status == "released" {
		return reservation, nil
	}
	response, err := federationprovider.Exchange(ctx, p.Command, federationprovider.Request{
		Version: 1, Operation: "release", RequestID: p.RequestID,
	})
	if err != nil {
		return reservation, err
	}
	if response.Status != "released" {
		return reservation, errors.New("federation provider release is not confirmed")
	}
	replacement := reservation
	next := *p
	next.Status = "released"
	replacement.Credential.Provider = &next
	if err := managed.ReplaceManagedFederationCredential(ctx, reservation, replacement); err != nil {
		return reservation, err
	}
	return replacement, nil
}
