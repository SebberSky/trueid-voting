# Google Sheet backend setup

1. Open the voting Google Sheet.
2. Choose **Extensions → Apps Script**.
3. Replace the default code with the contents of `Code.gs`.
4. Save, then run `setup` once and authorize it.
5. Choose **Deploy → New deployment → Web app**.
6. Set **Execute as: Me** and **Who has access: Anyone**.
7. Copy the Web app URL; the website will use it for `GET ?action=config`, `GET ?action=results`, and `POST` actions `vote` / `saveConfig`.

Each voter must send a stable `voterId` (the Jira account ID). The script rejects a second vote from the same ID.
