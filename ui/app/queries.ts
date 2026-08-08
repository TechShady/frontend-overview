import { periodClause, webAppFilterClause } from "./SettingsContext";

// Every query aggregates by `application` — actual DQL field is `frontend.name`
// (or `dt.entity.application` for metrics). Consumers use `application` uniformly.
//
// Schema notes for guu84124 (Demo Live) — verified 2026-08:
//   `event.type`, `error.name`, `error.message`, `view.network.*`, `view.dom_complete`,
//   `dt.rum.user.id`, `user_agent.family`, `geolocation.country` DO NOT EXIST.
//   Use `characteristics.has_error`, `characteristics.classifier`, `error.type`,
//   `browser.name`, `os.name`, `device.type`, `geo.country.iso_code` instead.
//   `duration`, `web_vitals.*` are nanoseconds → divide by 1_000_000.0 for ms.

// Robot filter — align with user-journey-app style (skip synthetic monitors).
const robotFilter = `| filter dt.rum.user_type != "robot"`;

// Discover every web app — powers the filter dropdown.
export function webAppInventoryQuery(days: number): string {
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)
    | summarize
        sessions = countDistinct(dt.rum.session.id),
        actions = count(),
        by:{application = frontend.name}
    | sort sessions desc
    | limit 200
  `;
}

// Per-web-app aggregate — sessions, users, actions, errors, duration, Apdex.
// Note: `dt.rum.user.id` is mostly null in this tenant → use session count as a proxy.
// `avgDuration` returned in ms (converted from nanoseconds). Apdex uses 3s / 12s
// thresholds on user_action/user_interaction events (industry standard).
export function webAppSummaryQuery(days: number, selected: string | null, prev = false): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days, prev)}
    | filter isNotNull(frontend.name)${filt}
    | fieldsAdd dur_ms = toDouble(duration) / 1000000.0,
        isAction = characteristics.classifier == "user_action" or characteristics.classifier == "user_interaction" or characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary" or characteristics.classifier == "navigation"
    | summarize
        sessions = countDistinct(dt.rum.session.id),
        users = countDistinct(dt.rum.session.id),
        actions = countIf(isAction),
        errors = countIf(characteristics.has_error == true),
        avgDuration = avg(if(isAction, dur_ms)),
        p50Duration = percentile(if(isAction, dur_ms), 50),
        p90Duration = percentile(if(isAction, dur_ms), 90),
        satisfied = countIf(isAction and dur_ms <= 3000),
        tolerating = countIf(isAction and dur_ms > 3000 and dur_ms <= 12000),
        frustrated = countIf(isAction and dur_ms > 12000),
        by:{application = frontend.name}
    | fieldsAdd
        errorRate = (toDouble(errors) / (toDouble(actions) + 0.0001)) * 100,
        apdex = (toDouble(satisfied) + toDouble(tolerating) * 0.5) / (toDouble(satisfied + tolerating + frustrated) + 0.0001),
        newUsers = 0,
        bounceRate = 0.0
    | sort sessions desc
    | limit 200
  `;
}

// Core Web Vitals per web app — from user.events (metric namespace unavailable in guu84124).
// Values converted from nanoseconds → milliseconds. CLS remains unitless.
export function webVitalsPerAppQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)${filt}
    | filter isNotNull(web_vitals.largest_contentful_paint)
       or isNotNull(web_vitals.interaction_to_next_paint)
       or isNotNull(web_vitals.cumulative_layout_shift)
       or isNotNull(web_vitals.time_to_first_byte)
       or isNotNull(web_vitals.first_contentful_paint)
    | fieldsAdd
        lcp_ms = toDouble(web_vitals.largest_contentful_paint) / 1000000.0,
        inp_ms = toDouble(web_vitals.interaction_to_next_paint) / 1000000.0,
        cls_val = toDouble(web_vitals.cumulative_layout_shift),
        ttfb_ms = toDouble(web_vitals.time_to_first_byte) / 1000000.0,
        fcp_ms = toDouble(web_vitals.first_contentful_paint) / 1000000.0,
        load_end_ms = toDouble(performance.load_event_end) / 1000000.0
    | summarize
        lcpAvg = avg(lcp_ms),
        lcpP75 = percentile(lcp_ms, 75),
        inpAvg = avg(inp_ms),
        inpP75 = percentile(inp_ms, 75),
        clsAvg = avg(cls_val),
        clsP75 = percentile(cls_val, 75),
        ttfbAvg = avg(ttfb_ms),
        ttfbP75 = percentile(ttfb_ms, 75),
        fcpAvg = avg(fcp_ms),
        fcpP75 = percentile(fcp_ms, 75),
        loadEndAvg = avg(load_end_ms),
        loadEndP75 = percentile(load_end_ms, 75),
        samples = count(),
        by:{application = frontend.name}
    | sort samples desc
    | limit 200
  `;
}

// Fallback: computed from user events when metrics are absent. Same as inventory,
// kept for backward compatibility with any component still importing it.
export function webVitalsFromEventsQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)${filt}
    | summarize
        actions = count(),
        sessions = countDistinct(dt.rum.session.id),
        by:{application = frontend.name}
    | sort sessions desc
    | limit 200
  `;
}

// Failure / error rate per web app.
export function errorsPerAppQuery(days: number, selected: string | null, prev = false): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days, prev)}
    | filter isNotNull(frontend.name)${filt}
    | summarize
        totalActions = countIf(characteristics.classifier == "user_action" or characteristics.classifier == "user_interaction" or characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary" or characteristics.classifier == "navigation"),
        totalErrors = countIf(characteristics.has_error == true),
        sessions = countDistinct(dt.rum.session.id),
        errSessions = countDistinct(if(characteristics.has_error == true, dt.rum.session.id)),
        by:{application = frontend.name}
    | fieldsAdd
        errorRate = (toDouble(totalErrors) / (toDouble(totalActions) + 0.0001)) * 100,
        errSessionsPct = (toDouble(errSessions) / (toDouble(sessions) + 0.0001)) * 100
    | sort errorRate desc
    | limit 200
  `;
}

// Top pages per web app. Uses page_summary / view_summary / user_action classifiers
// as the "page view" surrogate since `event.type == "ACTION"` doesn't exist.
export function topPagesQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and isNotNull(view.name)${filt}
    | filter characteristics.classifier == "user_action" or characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary" or characteristics.classifier == "navigation"
    | fieldsAdd dur_ms = toDouble(duration) / 1000000.0
    | summarize
        views = count(),
        avgDuration = avg(dur_ms),
        errors = countIf(characteristics.has_error == true),
        by:{application = frontend.name, name = view.name, type = characteristics.classifier}
    | sort views desc
    | limit 500
  `;
}

// Page transitions — collect view names per session as an array; transitions are
// computed client-side in NavigationFlowsTab because DQL `shift()` isn't available.
// The tab reads `path` (string[]) and derives from/to pairs.
export function pageTransitionsQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and isNotNull(view.name) and isNotNull(dt.rum.session.id)${filt}
    | filter characteristics.classifier == "user_action" or characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary" or characteristics.classifier == "navigation"
    | sort timestamp asc
    | summarize path = collectArray(view.name), by:{application = frontend.name, sessionId = dt.rum.session.id}
    | fieldsAdd pathLen = arraySize(path)
    | filter pathLen >= 2
    | fields application, sessionId, path, pathLen
    | limit 3000
  `;
}

// Resource consumption per web app. `view.network.bytes/requests` don't exist in
// this tenant — we approximate with classifier counts:
//   totalRequests = count of `request` classifier events (HTTP resource captures)
//   pageViews     = count of page/view summary events
//   avgDomComplete = avg page-summary event duration in ms (proxy for full-load time)
// Byte-level data (totalBytes / avgBytesPerView) is unavailable → returned as 0.
// The cost tab will therefore show request+RUM cost only until a byte metric exists.
export function resourceConsumptionQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)${filt}
    | fieldsAdd dur_ms = toDouble(duration) / 1000000.0
    | summarize
        pageViews = countIf(characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary"),
        totalRequests = countIf(characteristics.classifier == "request"),
        avgDomComplete = avg(if(characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary", dur_ms)),
        by:{application = frontend.name}
    | fieldsAdd
        totalBytes = 0.0,
        avgBytesPerView = 0.0,
        avgRequestsPerView = if(pageViews > 0, toDouble(totalRequests) / toDouble(pageViews), else: 0.0)
    | sort totalRequests desc
    | limit 200
  `;
}

// Third-party impact per web app. `view.third_party.*` doesn't exist in this
// tenant → return zero counts so the tab renders "no data" cleanly.
export function thirdPartyImpactQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)${filt}
    | summarize
        totalActions = count(),
        by:{application = frontend.name}
    | fieldsAdd
        totalBytes = 0.0,
        thirdPartyBytes = 0.0,
        thirdPartyRequests = 0,
        thirdPartyBytesPct = 0.0
    | sort totalActions desc
    | limit 200
  `;
}

// Traffic timeseries — sessions & actions over time per web app.
export function trafficTimeseriesQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)${filt}
    | makeTimeseries
        actions = count(),
        sessions = countDistinct(dt.rum.session.id),
        by:{application = frontend.name},
        interval:1h
    | sort application asc
    | limit 200
  `;
}

// Sessions over time — used by ExecutiveSummary sparkline. Same signature.
export function sessionsTimeseriesQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)${filt}
    | makeTimeseries
        sessions = countDistinct(dt.rum.session.id),
        interval:1h
    | limit 100
  `;
}

// Geo per web app. Uses `geo.country.iso_code` (2-letter code) since
// `geolocation.country` and `geo.country.name` don't exist in this tenant.
export function geoPerAppQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and isNotNull(geo.country.iso_code)${filt}
    | fieldsAdd dur_ms = toDouble(duration) / 1000000.0
    | summarize
        sessions = countDistinct(dt.rum.session.id),
        users = countDistinct(dt.rum.session.id),
        errors = countIf(characteristics.has_error == true),
        avgDuration = avg(dur_ms),
        by:{application = frontend.name, country = geo.country.iso_code}
    | sort sessions desc
    | limit 500
  `;
}

// Device / browser / OS breakdown per web app.
// Uses `browser.name` since `user_agent.family` / `browser.family` don't exist.
export function deviceBreakdownQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and isNotNull(browser.name)${filt}
    | fieldsAdd dur_ms = toDouble(duration) / 1000000.0
    | summarize
        sessions = countDistinct(dt.rum.session.id),
        errors = countIf(characteristics.has_error == true),
        avgDuration = avg(dur_ms),
        by:{
          application = frontend.name,
          browserFamily = browser.name,
          osFamily = os.name,
          deviceType = device.type
        }
    | sort sessions desc
    | limit 500
  `;
}

// Top JS error types per web app. `error.message` / `error.name` don't exist in
// this tenant → group by `error.type` (e.g. "csp", "request", "js_error"), falling
// back to classifier for events without a type.
export function jsErrorsQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and characteristics.has_error == true${filt}
    | summarize
        errors = count(),
        affectedSessions = countDistinct(dt.rum.session.id),
        by:{application = frontend.name, errorMessage = coalesce(error.type, characteristics.classifier, "Unknown")}
    | sort errors desc
    | limit 500
  `;
}

// Davis problems tied to web-app RUM services.
export function problemsQuery(days: number, selected: string | null): string {
  const filt = selected ? ` | filter contains(affected_entity_names, "${selected.replace(/"/g, '\\"')}")` : "";
  return `
    fetch dt.davis.problems, ${periodClause(days)}
    | filter event.category == "AVAILABILITY" or event.category == "ERROR" or event.category == "SLOWDOWN" or event.category == "RESOURCE"
    ${filt}
    | fields
        id = display_id,
        title = event.name,
        category = event.category,
        severity = event.status,
        start = event.start,
        end = event.end,
        affected = affected_entity_names,
        entities = affected_entity_ids
    | sort start desc
    | limit 500
  `;
}
