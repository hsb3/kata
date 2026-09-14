package main

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// An MCP client does not retry a stdio server that exits before initialize,
// so one timed-out startup health request used to disable the kata tools for
// the whole client session.
func TestMCPDaemonHealthRetriesTransientTimeout(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			select {
			case <-r.Context().Done():
			case <-time.After(2 * time.Second):
			}
			return
		}
		_, _ = w.Write([]byte(`{"api_schema_version":"` + apiVersionMCPServer + `"}`))
	}))
	t.Cleanup(server.Close)

	_, err := requireMCPDaemonHealth(t.Context(), &http.Client{Timeout: 200 * time.Millisecond}, server.URL)
	require.NoError(t, err)
	assert.Equal(t, int32(2), calls.Load())
}

func TestMCPDaemonHealthDoesNotRetryDaemonRejection(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte(`{"api_schema_version":"0.0.1"}`))
	}))
	t.Cleanup(server.Close)

	_, err := requireMCPDaemonHealth(t.Context(), &http.Client{Timeout: time.Second}, server.URL)
	require.Error(t, err)
	assert.Equal(t, int32(1), calls.Load())
}
