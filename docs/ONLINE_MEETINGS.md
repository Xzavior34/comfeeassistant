# Vabatim Online Meeting Ingestion Architecture

## Strategy
Vabatim supports online client assessments via authorized transcript and audio ingestion rather than covert system audio capture.

## Supported Adapters
- **Transcript Import**: Direct JSON/VTT canonical transcript import from MS Teams, Zoom, or Google Meet.
- **Provider Interfaces**: `TeamsProvider`, `ZoomProvider`, `GoogleMeetProvider` abstractions (`PARTIALLY IMPLEMENTED / MOCKED`).
