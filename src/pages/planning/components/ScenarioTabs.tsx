import { cn } from '../../../lib/utils';
import type { PlanScenario } from '../../../types';

interface ScenarioTabsProps {
  scenarios: PlanScenario[];
  activeScenarioId: string;
  onScenarioChange: (scenarioId: string) => void;
}

export function ScenarioTabs({
  scenarios,
  activeScenarioId,
  onScenarioChange,
}: ScenarioTabsProps) {
  return (
    <div className="scenario-tabs">
      {scenarios.map((scenario) => (
        <button
          key={scenario.id}
          className={cn(
            'scenario-tab',
            scenario.id === activeScenarioId && 'active'
          )}
          onClick={() => onScenarioChange(scenario.id)}
        >
          {scenario.name}
        </button>
      ))}
    </div>
  );
}
