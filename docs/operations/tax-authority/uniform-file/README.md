# Uniform file (מבנה אחיד 1.31): the simulator check for the registration (MUT-569 → MUT-567)

The Instruction 36 registration (MUT-567) declares MTB3A's uniform-file module, version 1.31, and attaches the result
file from the Tax Authority's simulator. This folder holds what you upload and, once you've run it, what you save.

## What's here

| Path | What it is |
|---|---|
| `fixture/INI.TXT` | the file's summary record (A000) and counts, ISO-8859-8 |
| `fixture/BKMVDATA.TXT` | 2,345 records: A100, 761 documents (C100) of every type (305, 320, 330, 400), 1,277 lines (D110), 305 payments (D120), Z900. 843 KB. |
| `fixture/OPENFRMT-fixture.zip` | the same export as the portal downloads it (OPENFRMT folder + report) |
| `fixture/report.html` | the summary MTB3A prints after producing the file |
| `simulator-report-<date>.*` | **you add this:** the simulator's result file |

The fixture is a made-up business, "ברמג׳יאת בע״מ", VAT 515151512, with a year of documents. It covers:

- customers and lines in Hebrew, Arabic and English (Arabic is written in Hebrew letters, decision D2);
- discounts, VAT-inclusive prices and exempt lines;
- cash and bank payments, and receipts with no customer;
- credit notes.

To make it again:

```bash
cd server && UNIFORM_FILE_FIXTURE_OUT="$PWD/../docs/operations/tax-authority/uniform-file/fixture" npx vitest run src/__tests__/uniform-file-fixture.test.ts
```

## Run the simulator (you, about 5 minutes)

1. Open https://www.misim.gov.il/TmbakmmsmlNew/frmCheckFiles.aspx (from gov.il › "סימולטור לבדיקת קובץ במבנה אחיד לרישום תוכנה במס הכנסה" › למעבר לסימולטור).
2. In **סט תוים**, choose **Windows (ANSI) ISO-8859-8-I**.
3. In **INI.TXT**, choose `fixture/INI.TXT`. In **BKMVDATA.TXT**, choose `fixture/BKMVDATA.TXT`. Use the plain `.TXT` files, not the zip.
4. Press the check button and wait for the result.
5. Save the file the simulator produces here as `simulator-report-YYYY-MM-DD.<ext>`, using its own extension. That's the file MUT-567 attaches.
6. If it reports errors, send the screen or the file to the MUT-569 session. The fix and a new fixture go in the same ticket.

## Before the real registration

- **The registration number (A000 1006)** is `00000000` in the fixture. Set `UNIFORM_FILE_REGISTRATION_NUMBER` once MUT-567 issues the certificate.
- **The software house (A000 1009/1010)** is a placeholder (`000000000`, `Barmajiyat`). Set `SOFTWARE_HOUSE_VAT_ID` to Barmajiyat's Israeli company number and `SOFTWARE_HOUSE_NAME` to its registered name (up to 20 characters) in the API's config, then make the fixture again before you upload. The simulator check doesn't need them, but the registration does.
- **Open questions for the accountant** are in the MUT-567 ticket: whether B100/B110 journal records are needed (D1; MTB3A writes none, A000 1013 = 0) and whether Arabic written in Hebrew letters is acceptable (D2).
