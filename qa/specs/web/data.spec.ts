import fs from 'node:fs';
import JSZip from 'jszip';
import type { Download, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { localDateFromToday, logIncome, openFreshApp } from '../../support/app';

// Settings › Your data (MUT-88, ADR-072): every file comes back in through one
// Restore… picker, which reads the file and sends it where it belongs: a full
// backup to the Replace everything dialog, anything else to /settings/import.

interface PickedFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

type BackupJson = { version: number; timestamp: string; tables: Record<string, Array<Record<string, unknown>>> };

const now = () => new Date().toISOString();

/** Clicks Restore… in Settings › Your data and picks `file` in the file chooser it opens. */
async function restoreFile(page: Page, file: PickedFile): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('main').getByRole('button', { name: 'Restore…' }).click();
  await (await chooser).setFiles(file);
}

/** Runs `click` and returns the download it starts. */
async function downloadFrom(page: Page, click: () => Promise<void>): Promise<Download> {
  const download = page.waitForEvent('download');
  await click();
  return download;
}

async function readDownload(download: Download): Promise<Buffer> {
  return fs.readFileSync(await download.path());
}

/** Settings › Your data › Back up now, returning the backup it downloaded. */
async function backUpNow(page: Page): Promise<{ download: Download; backup: BackupJson }> {
  const download = await downloadFrom(page, () =>
    page.getByRole('main').getByRole('button', { name: 'Back up now' }).click(),
  );
  const backup = JSON.parse((await readDownload(download)).toString('utf8')) as BackupJson;
  return { download, backup };
}

/** Confirms the Replace everything dialog and waits for the app to reload into Settings. */
async function replaceEverything(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Replace everything with this backup?' });
  await expect(dialog).toBeVisible();
  const reloaded = page.waitForEvent('load');
  await dialog.getByRole('button', { name: 'Replace everything' }).click();
  await reloaded;
}

/** One figure in the CSV validation summary ("New:", "Errors:"…), label and value together. */
function validationStat(page: Page, label: string) {
  return page.getByRole('main').getByText(label, { exact: true }).locator('xpath=..');
}

/** A header line and the CSV rows that follow it, as the file chooser hands it over. */
function csvFile(name: string, lines: string[]): PickedFile {
  const header = 'type,name,email,phone,client,project,field,amount,currency,status,date,dueDate,paidAt,category,notes';
  return { name, mimeType: 'text/csv', buffer: Buffer.from([header, ...lines].join('\n')) };
}

function jsonFile(name: string, data: unknown): PickedFile {
  return { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data, null, 2)) };
}

test(
  'a CSV of income imports through Restore, with a validation preview that holds back the broken row',
  { tag: '@web.data.csv-import' },
  async ({ page, step }) => {
    const today = localDateFromToday(0);
    const main = page.getByRole('main');
    const csv = csvFile('rawan-income.csv', [
      'client,Rawan Studio,rawan@example.com,,,,,,,,,,,,',
      `income,Brand guidelines,,,Rawan Studio,,,1200,USD,paid,${today},,,,`,
      `income,Website copy,,,Rawan Studio,,,800,USD,unpaid,${today},,,,`,
      'income,Undated retainer,,,Rawan Studio,,,300,USD,unpaid,,,,,',
    ]);

    await step('Open Settings, click Restore… and pick the CSV', async () => {
      await openFreshApp(page, '/settings');
      await restoreFile(page, csv);
      await expect(page).toHaveURL(/\/app\/settings\/import$/);
      await expect(main.getByRole('heading', { name: 'Import Data' })).toBeVisible();
      await expect(main.getByText('rawan-income.csv')).toBeVisible();
      await expect(main.getByText('CSV Import: 1 clients, 0 projects, 3 income, 0 expenses')).toBeVisible();
    });

    await step('Choose the business to file it under, then Next: Validate Data', async () => {
      const next = main.getByRole('button', { name: 'Next: Validate Data' });
      await expect(next).toBeDisabled();
      await main.getByRole('combobox').selectOption({ label: 'Default Profile' });
      await next.click();
      await expect(main.getByRole('heading', { name: 'Validate CSV Data' })).toBeVisible();
    });

    await step('Read the preview: the two good income rows are new and ticked, the undated one is an error that cannot be ticked', async () => {
      await expect(validationStat(page, 'Total Rows:')).toHaveText('Total Rows:4');
      await expect(validationStat(page, 'Errors:')).toHaveText('Errors:1');
      await expect(validationStat(page, 'Selected:')).toHaveText('Selected:3');
      for (const title of ['Brand guidelines', 'Website copy']) {
        const row = main.getByRole('row', { name: new RegExp(title) });
        await expect(row).toContainText('New');
        await expect(row.getByRole('checkbox')).toBeChecked();
      }
      const broken = main.getByRole('row', { name: /Undated retainer/ });
      await expect(broken).toContainText('Date is required for income');
      await expect(broken.getByRole('checkbox')).toBeDisabled();
      await expect(broken.getByRole('checkbox')).not.toBeChecked();
    });

    await step('Import 3 Rows (the client and the two good entries)', async () => {
      await main.getByRole('button', { name: 'Import 3 Rows' }).click();
      await expect(main.getByRole('heading', { name: 'Import Complete!' })).toBeVisible();
      await expect(main.getByText('Imported 2 transactions')).toBeVisible();
    });

    await step('Open Income: both good entries are there under the new client, the broken one is not', async () => {
      await page.goto('/app/income');
      const paid = page.getByRole('row', { name: /Brand guidelines/ });
      const unpaid = page.getByRole('row', { name: /Website copy/ });
      await expect(paid).toContainText('Rawan Studio');
      await expect(paid).toContainText('$1,200');
      await expect(paid).toContainText('Paid');
      await expect(unpaid).toContainText('$800');
      await expect(unpaid).toContainText('Unpaid');
      await expect(page.getByRole('row', { name: /Undated retainer/ })).toHaveCount(0);
    });
  },
);

// Product bug (manual in data.yaml): validateCSVImport adds the CSV's own client and project
// names to the "already exists" list before checking them, so every new client in a CSV is
// shown as a Duplicate of itself. This spec states the correct behaviour.
test(
  'a client that is new to this device shows as New in the CSV validation preview, not Duplicate',
  { tag: '@web.data.csv-new-client' },
  async ({ page, step }) => {
    const main = page.getByRole('main');

    await step('Open Settings, click Restore… and pick a CSV with a new client and one entry for it', async () => {
      await openFreshApp(page, '/settings');
      await restoreFile(page, csvFile('hala-cafe.csv', [
        'client,Hala Cafe,,,,,,,,,,,,,',
        `income,Menu design,,,Hala Cafe,,,400,USD,unpaid,${localDateFromToday(0)},,,,`,
      ]));
      await main.getByRole('combobox').selectOption({ label: 'Default Profile' });
      await main.getByRole('button', { name: 'Next: Validate Data' }).click();
    });

    await step('The client row reads New, and nothing is called a duplicate', async () => {
      const client = main.getByRole('row', { name: /Hala Cafe/ });
      await expect(client).toContainText('New');
      await expect(client).not.toContainText('Client with this name already exists');
      await expect(validationStat(page, 'New:')).toHaveText('New:2');
      await expect(validationStat(page, 'Duplicates:')).toHaveText('Duplicates:0');
      await expect(main.getByText(/duplicates? detected/)).toHaveCount(0);
    });
  },
);

test(
  'a business exported as JSON comes back through Restore as a new business',
  { tag: '@web.data.business-import' },
  async ({ page, step }) => {
    const main = page.getByRole('main');
    let exported: PickedFile | undefined;

    await step('Log one entry', async () => {
      await openFreshApp(page, '/income');
      await logIncome(page, { title: 'Annual audit', amount: '900', client: 'Nour Legal' });
    });

    await step('Export the default business as JSON from Export a business', async () => {
      await page.goto('/app/settings');
      await main.getByRole('button', { name: 'Export…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Export a business' });
      await dialog.getByRole('button', { name: 'JSON (Legacy)' }).click();
      const download = await downloadFrom(page, () =>
        dialog.getByRole('button', { name: 'Export Default Profile' }).click(),
      );
      expect(download.suggestedFilename()).toMatch(/^mutaba3a-Default-Profile-\d{4}-\d{2}-\d{2}\.json$/);
      exported = { name: download.suggestedFilename(), mimeType: 'application/json', buffer: await readDownload(download) };
      await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
      await expect(dialog).toBeHidden();
    });

    await step('Click Restore… and pick that file: the import page suggests merging into the same business', async () => {
      await restoreFile(page, exported!);
      await expect(main.getByText('Profile: Default Profile')).toBeVisible();
      const importAs = main.getByRole('radiogroup', { name: 'Import as' });
      await expect(importAs.getByRole('radio', { name: /Merge into an existing profile/ })).toBeChecked();
    });

    await step('Choose Create a new profile, then Import JSON', async () => {
      await main.getByRole('radio', { name: /Create a new profile/ }).check();
      await main.getByRole('button', { name: 'Import JSON' }).click();
      await expect(main.getByRole('heading', { name: 'Import Complete!' })).toBeVisible();
      await expect(main.getByText('Imported 1 profile, 1 transactions')).toBeVisible();
    });

    await step('Back in Settings, Businesses lists two businesses', async () => {
      await main.getByRole('button', { name: 'Back to Settings', exact: true }).click();
      await expect(main.getByRole('button', { name: 'Actions for Default Profile' })).toHaveCount(2);
    });
  },
);

test(
  'Delete all data asks for a backup and the typed word, and that backup restores everything',
  { tag: '@web.data.delete-and-restore' },
  async ({ page, step }) => {
    const main = page.getByRole('main');
    let backupFile: PickedFile | undefined;

    await step('Log one entry', async () => {
      await openFreshApp(page, '/income');
      await logIncome(page, { title: 'Logo refresh', amount: '650', client: 'Sama Bakery' });
    });

    await step('Back up now in Settings › Your data', async () => {
      await page.goto('/app/settings');
      await expect(main.getByText(/^Not backed up yet/)).toBeVisible();
      const { download } = await backUpNow(page);
      expect(download.suggestedFilename()).toMatch(/^mutaba3a-backup-v\d+-\d{4}-\d{2}-\d{2}\.json$/);
      await expect(main.getByText(/^Last backed up: /)).toBeVisible();
    });

    await step('Click Delete all data…, back up in step 1, type DELETE and delete permanently', async () => {
      await main.getByRole('button', { name: 'Delete all data…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Delete All Data' });
      const word = dialog.getByLabel('Type DELETE to confirm');
      const remove = dialog.getByRole('button', { name: 'Delete permanently' });
      await expect(word).toBeDisabled();
      await expect(remove).toBeDisabled();

      const download = await downloadFrom(page, () => dialog.getByRole('button', { name: 'Back up', exact: true }).click());
      backupFile = { name: download.suggestedFilename(), mimeType: 'application/json', buffer: await readDownload(download) };
      await expect(dialog.getByText('Backed up', { exact: true })).toBeVisible();

      await word.fill('DELETE');
      await remove.click();
      await expect(dialog).toBeHidden();
      await expect(main.getByText('All data deleted successfully')).toBeVisible();
      await expect(page).toHaveURL(/\/app\/?$/);
    });

    await step('Open Income: it is empty', async () => {
      await page.goto('/app/income');
      await expect(main.getByText('No income yet')).toBeVisible();
      await expect(page.getByRole('row', { name: /Logo refresh/ })).toHaveCount(0);
    });

    await step('Back in Settings, click Restore…, pick the backup and Replace everything', async () => {
      await page.goto('/app/settings');
      await restoreFile(page, backupFile!);
      const dialog = page.getByRole('dialog', { name: 'Replace everything with this backup?' });
      await expect(dialog).toContainText(/The backup from .+ holds \d+ records\. Everything on this device now will be replaced by it\./);
      await replaceEverything(page);
    });

    await step('The entry and its client are back', async () => {
      await page.goto('/app/income');
      const row = page.getByRole('row', { name: /Logo refresh/ });
      await expect(row).toContainText('Sama Bakery');
      await expect(row).toContainText('$650');
    });
  },
);

test(
  'records from an old export with no business show a banner; Review now assigns them and the check comes back clean',
  { tag: '@web.data.unassigned-records' },
  async ({ page, step }) => {
    const main = page.getByRole('main');
    const stamp = now();
    // A pre-business (v1) export: rows from before business profiles existed carry no profileId
    const legacy = {
      exportedAt: stamp,
      clients: [{ id: 'legacy-client-1', name: 'Old Client', createdAt: stamp, updatedAt: stamp }],
      projects: [],
      transactions: [
        {
          id: 'legacy-tx-1',
          kind: 'income',
          status: 'unpaid',
          title: 'Old invoice',
          clientId: 'legacy-client-1',
          amountMinor: 45000,
          currency: 'USD',
          occurredAt: localDateFromToday(0),
          createdAt: stamp,
          updatedAt: stamp,
        },
      ],
    };
    const banner = page.getByRole('alert').filter({ hasText: "aren't assigned to any profile" });
    const runCheck = () => main.getByRole('button', { name: 'Run Check' }).click();

    await step('Click Restore… and pick the legacy export: the import page warns it replaces everything', async () => {
      await openFreshApp(page, '/settings');
      await restoreFile(page, jsonFile('mutaba3a-export-2024.json', legacy));
      await expect(main.getByText('Legacy format (all data)')).toBeVisible();
      await expect(main.getByText('This is a legacy backup file. Importing will replace all existing data.')).toBeVisible();
    });

    await step('Import JSON', async () => {
      await main.getByRole('button', { name: 'Import JSON' }).click();
      await expect(main.getByRole('heading', { name: 'Import Complete!' })).toBeVisible();
      await expect(banner).toContainText("2 records aren't assigned to any profile.");
    });

    await step('Run the Data Integrity Check in Settings', async () => {
      await main.getByRole('button', { name: 'Back to Settings', exact: true }).click();
      await runCheck();
      await expect(main.getByText('Found 2 issues. Records checked: 2.')).toBeVisible();
    });

    await step('Click Review now and Assign all to Default Profile', async () => {
      await banner.getByRole('button', { name: 'Review now' }).click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'Unassigned records' });
      await expect(drawer.getByText('Clients (1)')).toBeVisible();
      await expect(drawer.getByText('Income (1)')).toBeVisible();
      await expect(drawer.getByTestId('orphan-row-legacy-client-1')).toHaveText('Old Client');
      // The entry is labelled by its title, with its client and amount beside it
      const entry = drawer.getByTestId('orphan-row-legacy-tx-1');
      await expect(entry).toContainText('Old invoice');
      await expect(entry).toContainText('Old Client');
      await expect(entry).toContainText('$450');
      await drawer.getByRole('button', { name: 'Assign all to Default Profile' }).click();
      await expect(drawer).toBeHidden();
      await expect(page.getByText('2 records assigned.')).toBeVisible();
      await expect(banner).toHaveCount(0);
    });

    await step('Run the check again and open Income', async () => {
      await runCheck();
      await expect(main.getByText('No issues found. Records checked: 2.')).toBeVisible();
      await page.goto('/app/income');
      const row = page.getByRole('row', { name: /Old invoice/ });
      await expect(row).toContainText('Old Client');
      await expect(row).toContainText('$450');
    });
  },
);

test(
  'a backup made by an older build restores in full: migration review, receipts ZIP, retained invoices and engagements',
  { tag: '@web.data.older-backup' },
  async ({ page, step }) => {
    const main = page.getByRole('main');
    let olderBackup: PickedFile | undefined;

    await step('Take a backup that still carries a flagged entry, a receipt, an invoice and an engagement', async () => {
      // An older build's backup: the rows the current app no longer creates. The file starts from this
      // device's own backup so its schema version is one the app accepts.
      await openFreshApp(page, '/settings');
      const { backup } = await backUpNow(page);
      const profileId = String(backup.tables.businessProfiles[0].id);
      const stamp = now();
      backup.tables.transactions = [
        ...(backup.tables.transactions ?? []),
        {
          id: 'flagged-tx-1',
          kind: 'income',
          status: 'unpaid',
          title: 'Flagged retainer',
          amountMinor: 30000,
          currency: 'USD',
          occurredAt: localDateFromToday(0),
          profileId,
          needsReview: true,
          createdAt: stamp,
          updatedAt: stamp,
        },
      ];
      backup.tables.receipts = [
        {
          id: 'receipt-1',
          profileId,
          monthKey: '2025-03',
          fileName: 'printer-ink.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 11,
          data: Buffer.from('%PDF-1.4 qa').toString('base64'),
          createdAt: stamp,
          updatedAt: stamp,
        },
      ];
      backup.tables.documents = [
        { id: 'doc-1', number: 'INV-0007', type: 'invoice', status: 'issued', businessProfileId: profileId, createdAt: stamp, updatedAt: stamp },
      ];
      backup.tables.engagements = [
        { id: 'eng-1', profileId, clientId: 'gone-client', type: 'task', category: 'design', primaryLanguage: 'en', status: 'final', createdAt: stamp, updatedAt: stamp },
      ];
      olderBackup = jsonFile('mutaba3a-backup-older.json', backup);
    });

    await step('Restore it', async () => {
      await restoreFile(page, olderBackup!);
      await replaceEverything(page);
    });

    await step('The Data Migration review opens: download a backup and continue', async () => {
      const wizard = page.getByRole('dialog', { name: 'Data Migration' });
      await expect(wizard).toContainText('We found 1 record that needs to be assigned to a business profile.');
      const download = await downloadFrom(page, () => wizard.getByRole('button', { name: 'Download backup' }).click());
      expect(download.suggestedFilename()).toMatch(/^mutaba3a-backup-v\d+-\d{4}-\d{2}-\d{2}\.json$/);
      await expect(wizard.getByText(/Backup downloaded/)).toBeVisible();
      await wizard.getByRole('button', { name: 'Continue' }).click();
    });

    await step('Review the flagged entry, then Migrate now twice and Done', async () => {
      await expect(page.getByRole('heading', { name: 'Review & Assign' })).toBeVisible();
      const row = page.getByRole('row', { name: /Flagged retainer/ });
      await expect(row).toContainText('300.00 USD');
      await expect(row.getByRole('combobox')).toHaveValue(/.+/);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { name: 'Confirm Migration' })).toBeVisible();
      await page.getByRole('button', { name: 'Migrate now' }).click();
      await expect(page.getByRole('heading', { name: 'Are you sure?' })).toBeVisible();
      await page.getByRole('button', { name: 'Migrate now' }).click();
      await expect(page.getByRole('heading', { name: 'Migration Complete' })).toBeVisible();
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page.getByRole('heading', { name: 'Migration Complete' })).toBeHidden();
    });

    await step('Reload: the review does not come back', async () => {
      await page.reload();
      await expect(main.getByRole('heading', { name: 'Your data' })).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Data Migration' })).toHaveCount(0);
    });

    await step('Download ZIP under Export receipts', async () => {
      const receipts = page.getByTestId('settings-export-receipts');
      await expect(receipts).toContainText('1 uploaded receipt files');
      const download = await downloadFrom(page, () => receipts.getByRole('button', { name: 'Download ZIP' }).click());
      expect(download.suggestedFilename()).toBe('mutaba3a_receipts.zip');
      await expect(page.getByText('1 receipts exported')).toBeVisible();
      const zip = await JSZip.loadAsync(await readDownload(download));
      expect(Object.keys(zip.files)).toContain('Default Profile/2025-03/printer-ink.pdf');
    });

    await step('Back up now: the invoice and engagement are still in it, and the entry is no longer flagged', async () => {
      const { backup } = await backUpNow(page);
      expect(backup.tables.documents.map((d) => d.number)).toContain('INV-0007');
      expect(backup.tables.engagements.map((e) => e.id)).toContain('eng-1');
      const entry = backup.tables.transactions.find((t) => t.id === 'flagged-tx-1');
      expect(entry?.needsReview).toBeFalsy();
      expect(entry?.profileId).toBe(backup.tables.businessProfiles[0].id);
    });
  },
);
