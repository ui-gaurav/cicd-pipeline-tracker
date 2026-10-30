/**
 * lib/failure-log.ts
 *
 * Pure functions for formatting and parsing structured failure logs.
 * No 'server-only' import so client components (FailureLogPanel) can use it.
 */

export const LOG_MARKER = '--- LOG (last 150 lines) ---';
export const ESCAPED_LOG_MARKER = '--- LOG (last 150 lines) --';

export interface FormatFailureLogOptions {
    jobName?: string;
    stepName?: string;
    reasonLines?: string[] | string;
    logTail?: string;
}

export interface ParsedFailureLog {
    structured: boolean;
    stepLabel?: string;
    reason?: string;
    logTail: string;
}

function norm(str: string = ''): string {
    return str.replace(/\r\n/g, '\n');
}

function stripNewlines(str: string): string {
    return str.replace(/[\r\n]/g, '');
}

function escapeMarker(str: string): string {
    return str.replaceAll(LOG_MARKER, ESCAPED_LOG_MARKER);
}

/**
 * Formats a structured failure log string.
 *
 * Output format:
 * FAILED STEP: <job> > <step>
 * REASON:
 * <reason lines>
 * 
 * --- LOG (last 150 lines) ---
 * <logTail>
 *
 * Rules:
 * - First normalise \r\n to \n
 * - Strip newlines from job and step names and truncate them to 120 characters
 * - Truncate each reason line to 300 characters
 * - Replace the exact text "--- LOG (last 150 lines) ---" wherever it appears in dynamic parts
 *   with the same text minus the final dash
 * - Empty reason lines fallback to "(no error lines found)"
 * - Result must never start with "Workflow:"
 */
export function formatFailureLog(options: FormatFailureLogOptions): string {
    const rawJob = norm(options.jobName || 'unknown job');
    const rawStep = norm(options.stepName || 'unknown step');

    const job = escapeMarker(stripNewlines(rawJob)).slice(0, 120);
    const step = escapeMarker(stripNewlines(rawStep)).slice(0, 120);

    let rawReasons: string[] = [];
    if (Array.isArray(options.reasonLines)) {
        rawReasons = options.reasonLines;
    } else if (typeof options.reasonLines === 'string') {
        rawReasons = options.reasonLines.split('\n');
    }

    const processedReasons = rawReasons
        .map((r) => norm(r))
        .flatMap((r) => r.split('\n'))
        .map((r) => escapeMarker(r).slice(0, 300))
        .filter((r) => r.trim().length > 0);

    const reasonText = processedReasons.length > 0
        ? processedReasons.join('\n')
        : '(no error lines found)';

    const logTail = escapeMarker(norm(options.logTail || ''));

    let result = `FAILED STEP: ${job} > ${step}\nREASON:\n${reasonText}\n\n${LOG_MARKER}\n${logTail}`;

    if (result.startsWith('Workflow:')) {
        result = `FAILED STEP: ${result}`;
    }

    return result;
}

/**
 * Parses a stored log string into structured components if possible.
 *
 * Rules:
 * - Normalise \r\n to \n
 * - It is structured only if the string starts with "FAILED STEP: "
 * - Split on the FIRST "\nREASON:\n" and the first "\n\n--- LOG (last 150 lines) ---\n" after it
 *   using indexOf (no regex backtracking).
 * - If any marker is missing, or the text starts with "Workflow:", return structured false
 *   with logTail set to the whole string.
 * - Never throws.
 */
export function parseFailureLog(logs: string | null | undefined): ParsedFailureLog {
    try {
        if (!logs || typeof logs !== 'string') {
            return { structured: false, logTail: logs ?? '' };
        }

        const s = norm(logs);

        if (s.startsWith('Workflow:')) {
            return { structured: false, logTail: s };
        }

        const PREFIX = 'FAILED STEP: ';
        if (!s.startsWith(PREFIX)) {
            return { structured: false, logTail: s };
        }

        const REASON_MARKER = '\nREASON:\n';
        const reasonIdx = s.indexOf(REASON_MARKER, PREFIX.length);
        if (reasonIdx === -1) {
            return { structured: false, logTail: s };
        }

        const LOG_MARKER_FULL = `\n\n${LOG_MARKER}\n`;
        const logIdx = s.indexOf(LOG_MARKER_FULL, reasonIdx + REASON_MARKER.length);
        if (logIdx === -1) {
            return { structured: false, logTail: s };
        }

        const stepLabel = s.slice(PREFIX.length, reasonIdx);
        const reason = s.slice(reasonIdx + REASON_MARKER.length, logIdx);
        const logTail = s.slice(logIdx + LOG_MARKER_FULL.length);

        return {
            structured: true,
            stepLabel,
            reason,
            logTail,
        };
    } catch {
        return { structured: false, logTail: typeof logs === 'string' ? logs : '' };
    }
}
