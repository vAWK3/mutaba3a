import { useT } from '../../../../lib/i18n';
import { SAMPLE_CLIENT, SAMPLE_WORK } from '../../sampleData';
import { useMockFormat } from './useMockFormat';

/** The two work rows the laptop has room for. */
const LAPTOP_ROWS = SAMPLE_WORK.slice(0, 2);

/** One client's name and Owed now, as both screens show it. */
function OwedSummary() {
  const t = useT();
  const { money } = useMockFormat();
  return (
    <>
      <span className="landing-mock-label">{t('common.client')}</span>
      <span className="hosted-devices-client">{t(SAMPLE_CLIENT.nameKey)}</span>
      <span className="landing-mock-label">{t('clients.profile.owedNow')}</span>
      <span className="landing-mock-amount" data-amount="owed">
        {money(SAMPLE_CLIENT.owedMinor, SAMPLE_CLIENT.currency)}
      </span>
    </>
  );
}

/**
 * The /hosted hero's anchor (MUT-186, 5A): the same client balance in a
 * browser on a laptop and on a phone, which is what hosted promises.
 * Decorative: the headline beside it says the same thing in words.
 */
export function HostedDevicesMock() {
  const t = useT();
  const { money } = useMockFormat();

  return (
    <div className="hosted-devices" data-part="devices-mock" aria-hidden="true">
      <div className="hosted-devices-laptop landing-mock">
        <div className="hosted-devices-chrome">
          <span />
          <span />
          <span />
        </div>
        <div className="hosted-devices-screen">
          <OwedSummary />
          <ul className="landing-mock-rows">
            {LAPTOP_ROWS.map((row) => (
              <li key={row.id} className="landing-mock-row">
                <span className="landing-mock-what">{t(row.titleKey)}</span>
                <span className="landing-mock-money">{money(row.amountMinor, row.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="hosted-devices-phone landing-mock">
        <OwedSummary />
      </div>
      <p className="hosted-devices-caption">{t('landing.hostedOffer.devices.caption')}</p>
    </div>
  );
}
