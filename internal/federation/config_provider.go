package federation

import (
	"context"
	"errors"
	"slices"
	"strings"

	clientpkg "go.kenn.io/kata/internal/client"
	"go.kenn.io/kata/internal/config"
	"go.kenn.io/kata/internal/daemon"
	"go.kenn.io/kata/internal/db"
)

// status comes only from a validated provider response, never its prose.
type providerDecisionError struct{ status string }

func (e *providerDecisionError) Error() string { return "federation credential provider: " + e.status }

func reconcileProviderMapping(
	ctx context.Context, store db.Storage, credentials config.FederationCredentialStore,
	catalog config.CatalogDaemonConfig, mapping config.FederationProjectConfig,
	wake func(), projectEventSink func(db.Event),
) (resultErr error) {
	if store == nil || credentials == nil || mapping.Hub != catalog.Name {
		return reconcileError(ErrConfigurationConflict, "invalid federation mapping dependencies")
	}
	if err := config.ValidateFederationAuthentication(mapping, catalog); err != nil {
		return reconcileError(ErrConfigurationConflict, "invalid federation provider configuration")
	}
	if daemon.FederationReplicaMappingSuppressed(store, mapping.SpokeProject) {
		return nil
	}
	_, event, err := resolveOrCreateLocalProject(ctx, store, mapping.SpokeProject)
	if event != nil && projectEventSink != nil {
		projectEventSink(*event)
	}
	if err != nil {
		return err
	}
	reservation, err := daemon.AuthorizeFederationProvider(ctx, store, credentials, catalog, mapping)
	if err != nil {
		return providerReconciliationError(err)
	}
	credential := reservation.Credential
	decision := credential.Provider
	if decision.Status != "ready" {
		return &providerDecisionError{status: decision.Status}
	}
	finish, err := daemon.BeginFederationReplicaHubOperation(ctx, store, credentials, mapping.SpokeProject, reservation)
	if err != nil {
		return providerReconciliationError(err)
	}
	defer func() {
		_, finishErr := finish(ctx, 0)
		resultErr = errors.Join(resultErr, finishErr)
	}()
	client, err := NewClient(ctx, credential.HubURL, credential.Token, clientpkg.Opts{Timeout: defaultFederationClientTimeout})
	if err != nil {
		return reconcileError(ErrConfigurationConflict, "invalid federation provider endpoint")
	}
	metadata, err := client.ProjectFederation(ctx, credential.HubProjectID)
	if err != nil {
		// A hub's error body is not safe to put in reconciliation logs.
		return reconcileError(ErrHubUnavailable, "read approved federation metadata")
	}
	if metadata.ProjectID != credential.HubProjectID || metadata.ProjectUID != decision.HubProjectUID || metadata.ReplayHorizonEventID <= 0 {
		return reconcileError(ErrBindingConflict, "federation metadata differs from the approved project")
	}
	params := daemon.EnsureFederationReplicaParams{
		HubURL: credential.HubURL, HubProjectID: credential.HubProjectID, HubProjectUID: decision.HubProjectUID,
		ProjectName: mapping.SpokeProject, ReplayHorizonEventID: metadata.ReplayHorizonEventID,
		Credential: credential, PushEnabled: slices.Contains(strings.Split(credential.Capabilities, ","), "push"),
		AdoptExisting: decision.Intent == "migrate", AttachEmpty: decision.Intent != "migrate",
		ManagedReservation: &daemon.FederationReplicaManagedReservation{ProjectUID: reservation.ProjectUID, Expected: credential},
		ProjectEventSink:   projectEventSink,
	}
	if reservation.ProjectUID != decision.HubProjectUID {
		params.CredentialRekey = &daemon.FederationReplicaCredentialRekeySource{ProjectUID: reservation.ProjectUID, Expected: credential}
	}
	_, err = daemon.EnsureFederationReplica(ctx, store, credentials, wake, params)
	return providerReconciliationError(err)
}

func providerReconciliationError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, config.ErrFederationCredentialConflict), errors.Is(err, daemon.ErrFederationReplicaCredentialConflict):
		return reconcileError(ErrConfigurationConflict, "federation provider operation conflicts with local state")
	case errors.Is(err, db.ErrFederationProjectNotEmpty), errors.Is(err, daemon.ErrFederationReplicaBindingConflict):
		return reconcileError(ErrBindingConflict, "federation attachment requires an empty project or explicit migration approval")
	case errors.Is(err, daemon.ErrFederationReplicaCredentialIO):
		return reconcileError(ErrCredentialIO, "save federation provider operation")
	default:
		return reconcileError(ErrHubUnavailable, "federation provider operation did not complete")
	}
}
