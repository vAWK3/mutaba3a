import { useMemo, useState } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { useBusinessProfiles } from '../../hooks/useQueries';
import {
  usePlans,
  usePlan,
  usePlanAssumptions,
  usePlanScenarios,
  usePlanProjections,
  useCreatePlan,
  useUpdatePlan,
  useArchivePlan,
} from '../../hooks/usePlanQueries';
import { useDrawerStore } from '../../lib/stores';
import { useProfileStore } from '../../lib/profileStore';
// formatAmount is used in child components via props
import { PlanSummaryStrip } from './components/PlanSummaryStrip';
import { ScenarioTabs } from './components/ScenarioTabs';
import { MonthlyTimeline } from './components/MonthlyTimeline';
import { AssumptionPanel } from './components/AssumptionPanel';
import { InsightPanel } from './components/InsightPanel';
import { exportPlanToCSV, exportAssumptionsToCSV } from './utils/exportPlan';
import './PlanningPage.css';

import type { PlanFilters } from '../../types';

export function PlanningPage() {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const navigate = useNavigate();
  const search = useSearch({ from: '/planning' });

  const { activeProfileId } = useProfileStore();
  const { data: profiles = [] } = useBusinessProfiles();

  // Get the actual profile ID (activeProfileId can be 'all' or a specific ID)
  const selectedProfileId = activeProfileId === 'all' ? undefined : activeProfileId;

  // Get plans for the selected profile (show both draft and active plans)
  const planFilters: PlanFilters = useMemo(
    () => ({
      profileId: selectedProfileId || undefined,
      // Don't filter by status - show both draft and active plans
    }),
    [selectedProfileId]
  );

  const { data: plans = [], isLoading: plansLoading } = usePlans(planFilters);

  // Selected plan from URL or first plan
  const selectedPlanId = search.plan || plans[0]?.id;
  const selectedScenarioId = search.scenario;

  const { data: plan, isLoading: planLoading } = usePlan(selectedPlanId || '');
  const { data: assumptions = [] } = usePlanAssumptions(selectedPlanId || '');
  const { data: scenarios = [] } = usePlanScenarios(selectedPlanId || '');
  const { data: projections, isLoading: projectionsLoading } = usePlanProjections(
    selectedPlanId || '',
    selectedScenarioId
  );

  const { openPlanAssumptionDrawer } = useDrawerStore();
  const createPlanMutation = useCreatePlan();
  const updatePlanMutation = useUpdatePlan();
  const archivePlanMutation = useArchivePlan();

  // State for editing plan name
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Get the active scenario
  const activeScenario = useMemo(() => {
    if (selectedScenarioId) {
      return scenarios.find((s) => s.id === selectedScenarioId);
    }
    return scenarios.find((s) => s.isDefault) || scenarios[0];
  }, [scenarios, selectedScenarioId]);

  // Handle scenario change
  const handleScenarioChange = (scenarioId: string) => {
    navigate({
      to: '/planning',
      search: {
        plan: selectedPlanId,
        scenario: scenarioId,
      },
    });
  };

  // Handle plan change
  const handlePlanChange = (planId: string) => {
    navigate({
      to: '/planning',
      search: {
        plan: planId,
      },
    });
  };

  // Get default profile
  const defaultProfile = useMemo(() => {
    if (selectedProfileId) {
      return profiles.find((p) => p.id === selectedProfileId);
    }
    return profiles.find((p) => p.isDefault) || profiles[0];
  }, [profiles, selectedProfileId]);

  // Handle create new plan
  const handleCreatePlan = async () => {
    if (!defaultProfile) return;

    const now = new Date();
    const startMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const newPlan = await createPlanMutation.mutateAsync({
      profileId: defaultProfile.id,
      name: t('planning.plan.defaultName'),
      currency: 'USD',
      startMonth,
      horizonMonths: 12,
      status: 'active',
      askMode: 'calculated',
    });

    navigate({
      to: '/planning',
      search: { plan: newPlan.id },
    });
  };

  // Handle add assumption
  const handleAddAssumption = (category?: 'revenue' | 'expense' | 'funding' | 'hiring' | 'other') => {
    if (!selectedPlanId || !defaultProfile) return;
    openPlanAssumptionDrawer({
      mode: 'create',
      planId: selectedPlanId,
      defaultCategory: category,
      defaultProfileId: defaultProfile.id,
    });
  };

  // Handle edit assumption
  const handleEditAssumption = (assumptionId: string) => {
    openPlanAssumptionDrawer({
      mode: 'edit',
      planId: selectedPlanId,
      assumptionId,
    });
  };

  // Handle export
  const handleExport = (type: 'projections' | 'assumptions') => {
    if (!plan || !projections) return;

    if (type === 'projections') {
      exportPlanToCSV(plan, projections.monthlyProjections, language);
    } else {
      exportAssumptionsToCSV(plan, assumptions, language);
    }
  };

  // Handle rename plan
  const handleStartRename = () => {
    if (plan) {
      setEditedName(plan.name);
      setIsEditingName(true);
    }
  };

  const handleSaveRename = async () => {
    if (!plan || !editedName.trim()) return;
    try {
      await updatePlanMutation.mutateAsync({
        id: plan.id,
        data: { name: editedName.trim() },
      });
      setIsEditingName(false);
    } catch (error) {
      console.error('Failed to rename plan:', error);
    }
  };

  const handleCancelRename = () => {
    setIsEditingName(false);
    setEditedName('');
  };

  // Handle delete/archive plan
  const handleDeletePlan = async () => {
    if (!plan) return;
    if (!confirm(t('planning.plan.confirmDelete'))) return;

    try {
      await archivePlanMutation.mutateAsync(plan.id);
      // Navigate to planning without plan param to show next plan or empty state
      navigate({ to: '/planning', search: {} });
    } catch (error) {
      console.error('Failed to delete plan:', error);
    }
  };

  const isLoading = plansLoading || planLoading || projectionsLoading;

  // Empty state - no profiles
  if (profiles.length === 0) {
    return (
      <div className="planning-page">
        <header className="page-header">
          <h1>{t('planning.title')}</h1>
        </header>
        <div className="empty-state">
          <p>{t('planning.emptyState.noProfile')}</p>
        </div>
      </div>
    );
  }

  // Empty state - no plans
  if (!isLoading && plans.length === 0) {
    return (
      <div className="planning-page">
        <header className="page-header">
          <h1>{t('planning.title')}</h1>
          <p className="page-subtitle">{t('planning.subtitle')}</p>
        </header>
        <div className="empty-state">
          <div className="empty-state-content">
            <h3>{t('planning.emptyState.title')}</h3>
            <p>{t('planning.emptyState.description')}</p>
            <button
              className="btn btn-primary"
              onClick={handleCreatePlan}
              disabled={createPlanMutation.isPending}
            >
              {createPlanMutation.isPending
                ? t('common.loading')
                : t('planning.emptyState.cta')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="planning-page">
      <header className="page-header">
        <div className="header-left">
          <h1>{t('planning.title')}</h1>
          {plan && (
            <div className="plan-name-section">
              {isEditingName ? (
                <div className="plan-name-edit">
                  <input
                    type="text"
                    className="input plan-name-input"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename();
                      if (e.key === 'Escape') handleCancelRename();
                    }}
                    autoFocus
                  />
                  <button className="btn btn-sm btn-primary" onClick={handleSaveRename}>
                    {t('common.save')}
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={handleCancelRename}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <div className="plan-name-display">
                  {plans.length > 1 ? (
                    <select
                      className="plan-select"
                      value={selectedPlanId || ''}
                      onChange={(e) => handlePlanChange(e.target.value)}
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="plan-name">{plan.name}</span>
                  )}
                  <div className="plan-actions-dropdown">
                    <button
                      className="btn btn-icon"
                      title={t('common.edit')}
                      onClick={() => setIsMenuOpen(!isMenuOpen)}
                    >
                      ⋮
                    </button>
                    {isMenuOpen && (
                      <>
                        <div
                          className="plan-actions-backdrop"
                          onClick={() => setIsMenuOpen(false)}
                        />
                        <div className="plan-actions-menu open">
                          <button onClick={() => { handleStartRename(); setIsMenuOpen(false); }}>
                            {t('planning.plan.rename')}
                          </button>
                          <button onClick={() => { handleDeletePlan(); setIsMenuOpen(false); }} className="danger">
                            {t('common.delete')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="header-right">
          <div className="export-dropdown">
            <button className="btn btn-secondary">
              {t('planning.export.button')}
            </button>
            <div className="export-menu">
              <button onClick={() => handleExport('projections')}>
                {t('planning.export.projections')}
              </button>
              <button onClick={() => handleExport('assumptions')}>
                {t('planning.export.assumptions')}
              </button>
            </div>
          </div>
          <button className="btn btn-secondary" onClick={handleCreatePlan}>
            {t('planning.plan.new')}
          </button>
        </div>
      </header>

      {isLoading ? (
        <div className="loading-state">
          <div className="spinner" />
        </div>
      ) : plan ? (
        <>
          {/* Summary Strip - only show when projections are ready */}
          {projections && (
            <PlanSummaryStrip
              summary={projections.summary}
            />
          )}

          {/* Scenario Tabs */}
          {scenarios.length > 0 && (
            <ScenarioTabs
              scenarios={scenarios}
              activeScenarioId={activeScenario?.id || ''}
              onScenarioChange={handleScenarioChange}
            />
          )}

          <div className="planning-grid">
            {/* Left: Timeline & Insights */}
            <div className="planning-main">
              {projections ? (
                <>
                  <MonthlyTimeline
                    projections={projections.monthlyProjections}
                    currency={plan.currency}
                    locale={locale}
                  />

                  {projections.insights.length > 0 && (
                    <InsightPanel insights={projections.insights} />
                  )}
                </>
              ) : (
                <div className="empty-timeline">
                  <p>{t('planning.emptyState.noProjections')}</p>
                </div>
              )}
            </div>

            {/* Right: Assumptions */}
            <div className="planning-sidebar">
              <AssumptionPanel
                assumptions={assumptions}
                currency={plan.currency}
                locale={locale}
                onAdd={handleAddAssumption}
                onEdit={handleEditAssumption}
              />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
