# Post-launch changes

## Demo login (2026-05-21)

Added a guest demo mode so casual visitors can explore the app without registering.

- `app/config.py` — added `DEMO_USERNAME` (default: `demo`) and `DEMO_PASSWORD` (default: `demo`)
- `scripts/seed_user.py` — now seeds both admin and demo users on every deploy
- Login page — "Try Demo" button auto-fills and submits demo credentials
- Divider line between Log in and Try Demo buttons

The demo user is created automatically on Railway deploy via the `release` command.
To customise the demo credentials, set `DEMO_USERNAME` and `DEMO_PASSWORD` in Railway variables.
