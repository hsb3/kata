package federationprovider

import (
	"bytes"
	"encoding/base64"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"regexp"
	"strings"
	"uuid"

	"go.kenn.io/kata/internal/config"
	"go.kenn.io/kata/internal/uid"
)

var canonicalUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

var authorizationFields = []string{"hub_url", "project", "spoke_instance_uid", "local_project_uid", "intent", "candidate_token"}
var readyFields = []string{"hub_url", "project_id", "project_uid", "enrollment_id", "actor", "capabilities", "expires_at"}

// The typed decoder rejects unknown and duplicate fields. The raw field map
// also distinguishes absent fields from null/zero fields forbidden in a status.
func decodeDocument(data []byte, destination any) (map[string]jsontext.Value, bool) {
	if len(data) > MaxDocumentBytes || json.Unmarshal(data, destination, json.RejectUnknownMembers(true)) != nil {
		return nil, false
	}
	var fields map[string]jsontext.Value
	if json.Unmarshal(data, &fields) != nil || fields == nil {
		return nil, false
	}
	for _, value := range fields {
		if bytes.Equal(value, []byte("null")) {
			return nil, false
		}
	}
	var requestID string
	if json.Unmarshal(fields["request_id"], &requestID) != nil || !canonicalUUID.MatchString(requestID) {
		return nil, false
	}
	return fields, true
}

func fieldsPresent(fields map[string]jsontext.Value, names []string, want bool) bool {
	for _, name := range names {
		_, exists := fields[name]
		if exists != want {
			return false
		}
	}
	return true
}

func decodeRequest(data []byte) (Request, error) {
	var request Request
	fields, ok := decodeDocument(data, &request)
	if !ok || !validRequest(request) || !fieldsPresent(fields, authorizationFields, request.Operation == "authorize") {
		return Request{}, ErrInvalidRequest
	}
	return request, nil
}

func validRequest(request Request) bool {
	if request.Version != 1 || request.RequestID == (uuid.UUID{}) {
		return false
	}
	if request.Operation == "release" {
		return request.HubURL == "" && request.Project == "" && request.SpokeInstanceUID == "" && request.LocalProjectUID == "" && request.Intent == "" && request.CandidateToken == ""
	}
	if request.Operation != "authorize" || strings.TrimSpace(request.Project) == "" || !validUID(request.SpokeInstanceUID) || !validUID(request.LocalProjectUID) {
		return false
	}
	if _, ok := httpsBase(request.HubURL); !ok || capabilitiesFor(request.Intent) == "" {
		return false
	}
	token, err := base64.RawURLEncoding.Strict().DecodeString(request.CandidateToken)
	return err == nil && len(token) == 32 && base64.RawURLEncoding.EncodeToString(token) == request.CandidateToken
}

func decodeResponse(data []byte, request Request) (Response, error) {
	var response Response
	fields, ok := decodeDocument(data, &response)
	if !ok || response.Version != 1 || response.Operation != request.Operation || response.RequestID != request.RequestID {
		return Response{}, ErrInvalidResponse
	}
	if !fieldsPresent(fields, readyFields, response.Status == "ready") {
		return Response{}, ErrInvalidResponse
	}
	switch response.Status {
	case "released", "conflict", "denied", "unavailable":
		return response, nil
	case "approval_required", "sign_in_required":
		if request.Operation == "authorize" {
			return response, nil
		}
	case "ready":
		base, validBase := httpsBase(response.HubURL)
		expectedBase, _ := httpsBase(request.HubURL)
		var expiry string
		if request.Operation != "authorize" || !validBase || base != expectedBase || response.ProjectID <= 0 || response.EnrollmentID <= 0 || !validUID(response.ProjectUID) || strings.TrimSpace(response.Actor) == "" || response.Capabilities != capabilitiesFor(request.Intent) || response.ExpiresAt.IsZero() || json.Unmarshal(fields["expires_at"], &expiry) != nil || !strings.HasSuffix(expiry, "Z") {
			return Response{}, ErrInvalidResponse
		}
		response.HubURL = base
		return response, nil
	}
	return Response{}, ErrInvalidResponse
}

func capabilitiesFor(intent string) string {
	switch intent {
	case "read_only":
		return "pull"
	case "collaborate", "migrate":
		return "claim,pull,push"
	default:
		return ""
	}
}

func validUID(value string) bool {
	return uid.Valid(value) && value == strings.ToUpper(value)
}

func httpsBase(value string) (string, bool) {
	base, err := config.CanonicalHTTPBaseURL(value)
	return base, err == nil && strings.HasPrefix(base, "https://")
}
