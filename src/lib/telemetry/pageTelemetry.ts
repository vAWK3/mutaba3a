import { TELEMETRY_OFF, telemetryAllowed, telemetryEnvironment, type TelemetryEnvironment, type TelemetryGate, type TelemetryTool } from './telemetryGate';

declare const __TELEMETRY__: TelemetryGate | undefined;

/** The build's gate (vite.config.ts `telemetryGate`); tests and builds without one send nothing. */
const BUILD_GATE: TelemetryGate = typeof __TELEMETRY__ !== 'undefined' && __TELEMETRY__ ? __TELEMETRY__ : TELEMETRY_OFF;

const pageHostname = () => (typeof window !== 'undefined' ? window.location.hostname : '');

/** Whether `tool` may send from this page (ADR-236): the build allows it and this is a production host, or it is forced on. */
export function telemetryOn(tool: TelemetryTool, hostname: string = pageHostname()): boolean {
  return telemetryAllowed(BUILD_GATE, tool, hostname);
}

/** The environment this page's events carry. */
export function pageTelemetryEnvironment(hostname: string = pageHostname()): TelemetryEnvironment {
  return telemetryEnvironment(BUILD_GATE, hostname);
}
