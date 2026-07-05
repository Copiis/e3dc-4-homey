# Architecture Notes

This app refactored from a monolith in device.ts.

Key extractions:
- Managers for capability, diagnostic, ems-schedule, power-mode, wallbox.
- LiveDataPoller for polling.
- RscpTagRegistry for tags.
- Wallbox data builder.

This reduces complexity and improves testability.
