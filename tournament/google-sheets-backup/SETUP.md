# OCPC Google Sheets failover backup

This free Google Apps Script runs inside the tournament spreadsheet and pulls a Firebase snapshot approximately every minute. It does not require Firebase Blaze billing.

## One-time setup

1. Open the tournament Google Sheet.
2. Choose **Extensions > Apps Script**.
3. Replace the editor contents with `Code.gs` from this folder.
4. Add an HTML file named `Credentials` and paste `Credentials.html` into it, then save the project.
5. Return to the spreadsheet and reload it.
6. Open **OCPC Backup > Set up automatic backup**.
7. Approve the requested Google permissions.
8. Enter an authorized Firebase Match Control email and password in the masked setup window.

The password is used once to obtain a Firebase refresh token and is then deleted from Apps Script properties. Restrict spreadsheet and Apps Script editor access to trusted tournament staff because the retained refresh token can read private registration data.

## Match-day use

- Confirm `Backup Control!B2` says `LIVE_SYNC`.
- Confirm **Last successful sync** changes every minute.
- If the website becomes unavailable, use **OCPC Backup > Start manual failover** before editing anything.
- Enter results in columns **H and I** of `LIVE - Schedule`.
- The script continues recalculating `LIVE - Standings` from those manual scores without overwriting them.
- Before resuming Firebase synchronization, copy or export manual scores. Resuming overwrites the LIVE tabs with Firebase again.

## Security or account changes

To revoke the saved Firebase session, open Apps Script, choose **Project Settings > Script properties**, and delete `FIREBASE_REFRESH_TOKEN`. Run setup again with the replacement account.
