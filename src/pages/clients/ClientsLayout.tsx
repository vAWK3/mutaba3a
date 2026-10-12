import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import {
  splitLayout,
  profileKeyAction,
  keyBelongsToControl,
  hasModifier,
  clientRowLink,
} from '../../components/clients/clientsSplitView';
import { useIsSplitView } from '../../hooks/useMediaQuery';
import { useClient } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { useT, useDirection } from '../../lib/i18n';
import { ClientsPage } from './ClientsPage';
import './ClientsLayout.css';

/**
 * The Clients area (MUT-84, ADR-050): `/clients` and `/clients/:id` under one
 * layout, so the list stays mounted while clients open and close.
 *
 * On a wide window (`BREAKPOINTS.clientsSplit`) a client opens beside the
 * list, like Mail: the list narrows to a column and the profile sits next to
 * it, mirrored in Arabic. On a narrow window the profile replaces the list,
 * as it always did. The two panes are always rendered in the same order and
 * only their attributes change, so resizing across the breakpoint never
 * remounts the profile, and switching clients never remounts the list (its
 * search, sort and scroll position stay).
 *
 * The layout owns the one top bar: "Clients" on the list; the open client's
 * name, the Clients breadcrumb and Edit when a client is open.
 */
export function ClientsLayout() {
  const { clientId } = useParams({ strict: false }) as { clientId?: string };
  const isWide = useIsSplitView();
  const layout = splitLayout(Boolean(clientId), isWide);
  const navigate = useNavigate();
  const direction = useDirection();
  const t = useT();
  const { openClientDrawer } = useDrawerStore();
  const listRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLElement>(null);

  const { data: client, isLoading: clientLoading } = useClient(clientId ?? '');

  // Announce a change of client (a walk, a click, Back), not the client the
  // page opened on: that one is already the page's title.
  const [shownClientId, setShownClientId] = useState(clientId);
  const [clientChanged, setClientChanged] = useState(false);
  if (shownClientId !== clientId) {
    setShownClientId(clientId);
    setClientChanged(true);
  }
  const announcement =
    layout === 'split' && clientChanged && client ? t('clients.split.showing', { name: client.name }) : '';

  /**
   * Open a client from the keyboard walk. The first one opened from the list
   * adds a history entry; walking on replaces it, so Back closes the profile
   * instead of replaying every step. The list's search and sort come along.
   */
  const walk = useCallback(
    (nextId: string) => {
      void navigate({ to: '/clients/$clientId', params: { clientId: nextId }, search: true, replace: Boolean(clientId) });
    },
    [navigate, clientId]
  );

  const enterProfile = useCallback(() => profileRef.current?.focus(), []);

  /** Back to the open client's row; if a search hides it, the first client, else the search box. */
  const returnToList = () => {
    const list = listRef.current;
    const target =
      clientRowLink(list, clientId) ??
      list?.querySelector<HTMLElement>('tr[data-client-id] a') ??
      list?.querySelector<HTMLElement>('.filters-row input');
    target?.focus();
  };

  const handleProfileKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (layout !== 'split' || event.defaultPrevented || hasModifier(event) || keyBelongsToControl(event.target)) return;
    if (profileKeyAction(event.key, direction) !== 'toList') return;
    event.preventDefault();
    returnToList();
  };

  const clientsCrumb = { label: t('nav.clients'), href: '/clients' };
  const topBar = !clientId
    ? { title: t('clients.title') }
    : clientLoading
      ? { title: t('common.loading'), breadcrumbs: [clientsCrumb] }
      : !client
        ? { title: t('clients.notFound'), breadcrumbs: [clientsCrumb] }
        : {
            title: client.name,
            breadcrumbs: [clientsCrumb, { label: client.name }],
            rightSlot: (
              <button className="btn btn-ghost" onClick={() => openClientDrawer({ mode: 'edit', clientId })}>
                {t('common.edit')}
              </button>
            ),
          };

  return (
    <>
      <TopBar {...topBar} />
      <div className="clients-split" data-layout={layout}>
        <div ref={listRef} className="clients-split-list" hidden={layout === 'profile'}>
          <ClientsPage
            openClientId={clientId}
            onWalk={isWide ? walk : undefined}
            onEnterProfile={layout === 'split' ? enterProfile : undefined}
          />
        </div>
        <section
          ref={profileRef}
          className="clients-split-profile"
          hidden={layout === 'list'}
          tabIndex={-1}
          aria-label={t('clients.split.profile')}
          onKeyDown={handleProfileKeyDown}
        >
          <Outlet />
        </section>
        <p className="sr-only" role="status">
          {announcement}
        </p>
      </div>
    </>
  );
}
