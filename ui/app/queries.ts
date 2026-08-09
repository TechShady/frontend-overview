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

// ---------------------------------------------------------------------------
// Bucketed per-app metrics — powers the Movement column in TimelapseTable.
// Chooses a bucket size so ~8 buckets span the timeframe. Returns one row per
// (application, bkt) with all sortable metrics.
// ---------------------------------------------------------------------------
export function bucketSizeForDays(days: number): { label: string; ms: number; count: number } {
  const totalHours = days * 24;
  // aim for 8-12 buckets
  const targetHours = Math.max(1, Math.floor(totalHours / 8));
  // snap to friendly sizes
  const choices = [1, 2, 3, 6, 12, 24, 48, 72, 168];
  const pick = choices.find((c) => c >= targetHours) ?? choices[choices.length - 1];
  return {
    label: `${pick}h`,
    ms: pick * 3600 * 1000,
    count: Math.max(1, Math.ceil(totalHours / pick)),
  };
}

export function webAppBucketedMetricsQuery(days: number, selected: string | null, bucketLabel?: string): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  const label = bucketLabel ?? bucketSizeForDays(days).label;
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)${filt}
    | fieldsAdd
        dur_ms = toDouble(duration) / 1000000.0,
        isAction = characteristics.classifier == "user_action" or characteristics.classifier == "user_interaction" or characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary" or characteristics.classifier == "navigation",
        bkt = bin(start_time, ${label})
    | summarize
        sessions = countDistinct(dt.rum.session.id),
        users = countDistinct(dt.rum.session.id),
        actions = countIf(isAction),
        errors = countIf(characteristics.has_error == true),
        avgDuration = avg(if(isAction, dur_ms)),
        satisfied = countIf(isAction and dur_ms <= 3000),
        tolerating = countIf(isAction and dur_ms > 3000 and dur_ms <= 12000),
        frustrated = countIf(isAction and dur_ms > 12000),
        lcp = avg(toDouble(web_vitals.largest_contentful_paint) / 1000000.0),
        inp = avg(toDouble(web_vitals.interaction_to_next_paint) / 1000000.0),
        cls = avg(toDouble(web_vitals.cumulative_layout_shift)),
        ttfb = avg(toDouble(web_vitals.time_to_first_byte) / 1000000.0),
        loadEnd = avg(toDouble(performance.load_event_end) / 1000000.0),
        by:{application = frontend.name, bkt}
    | fieldsAdd
        errorRate = (toDouble(errors) / (toDouble(actions) + 0.0001)) * 100,
        apdex = (toDouble(satisfied) + toDouble(tolerating) * 0.5) / (toDouble(satisfied + tolerating + frustrated) + 0.0001)
    | sort application asc, bkt asc
    | limit 5000
  `;
}

// Same shape but keyed by page/view — for NavigationFlows Top Pages table.
export function pagesBucketedMetricsQuery(days: number, selected: string | null, bucketLabel?: string): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  const label = bucketLabel ?? bucketSizeForDays(days).label;
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and isNotNull(view.url_path)${filt}
    | fieldsAdd bkt = bin(start_time, ${label}), dur_ms = toDouble(duration) / 1000000.0
    | summarize
        views = count(),
        sessions = countDistinct(dt.rum.session.id),
        errors = countIf(characteristics.has_error == true),
        avgDuration = avg(dur_ms),
        by:{page = view.url_path, bkt}
    | sort views desc
    | limit 5000
  `;
}

// Bucketed geo — per country per bucket.
export function geoBucketedMetricsQuery(days: number, selected: string | null, bucketLabel?: string): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  const label = bucketLabel ?? bucketSizeForDays(days).label;
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and isNotNull(geo.country.iso_code)${filt}
    | fieldsAdd bkt = bin(start_time, ${label}), dur_ms = toDouble(duration) / 1000000.0
    | summarize
        sessions = countDistinct(dt.rum.session.id),
        actions = count(),
        errors = countIf(characteristics.has_error == true),
        avgDuration = avg(dur_ms),
        by:{country = geo.country.iso_code, bkt}
    | sort sessions desc
    | limit 5000
  `;
}

// Bucketed device breakdown.
export function deviceBucketedMetricsQuery(days: number, selected: string | null, bucketLabel?: string): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  const label = bucketLabel ?? bucketSizeForDays(days).label;
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and isNotNull(device.type)${filt}
    | fieldsAdd bkt = bin(start_time, ${label}), dur_ms = toDouble(duration) / 1000000.0
    | summarize
        sessions = countDistinct(dt.rum.session.id),
        actions = count(),
        errors = countIf(characteristics.has_error == true),
        avgDuration = avg(dur_ms),
        by:{device = device.type, bkt}
    | sort sessions desc
    | limit 5000
  `;
}

// Bucketed error types — per (application, errorType).
export function errorsBucketedMetricsQuery(days: number, selected: string | null, bucketLabel?: string): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  const label = bucketLabel ?? bucketSizeForDays(days).label;
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and characteristics.has_error == true${filt}
    | fieldsAdd bkt = bin(start_time, ${label})
    | summarize
        errors = count(),
        affectedSessions = countDistinct(dt.rum.session.id),
        by:{errorMessage = coalesce(error.type, characteristics.classifier, "Unknown"), bkt}
    | sort errors desc
    | limit 5000
  `;
}

// ---------------------------------------------------------------------------
// Shared Time-Lapse metrics — one row per time bucket, aggregated across all
// selected web apps. Feeds the hotness Z-score strip in the header.
// bucketLabel accepts DQL-friendly duration literals: "1m", "5m", "10m",
// "30m", "1h", "3h", "6h", "12h", "24h".
// ---------------------------------------------------------------------------
export function sharedTimelapseMetricsQuery(days: number, selected: string | null, bucketLabel: string): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)${filt}
    | fieldsAdd
        dur_ms = toDouble(duration) / 1000000.0,
        isAction = characteristics.classifier == "user_action" or characteristics.classifier == "user_interaction" or characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary" or characteristics.classifier == "navigation",
        bkt = bin(start_time, ${bucketLabel})
    | summarize
        sessions = countDistinct(dt.rum.session.id),
        totalActions = countIf(isAction),
        avgDurationMs = avg(if(isAction, dur_ms)),
        errorCount = countIf(characteristics.has_error == true),
        lcp = avg(toDouble(web_vitals.largest_contentful_paint) / 1000000.0),
        cls = avg(toDouble(web_vitals.cumulative_layout_shift)),
        inp = avg(toDouble(web_vitals.interaction_to_next_paint) / 1000000.0),
        ttfb = avg(toDouble(web_vitals.time_to_first_byte) / 1000000.0),
        by:{bkt}
    | fieldsAdd errorRate = (toDouble(errorCount) / (toDouble(totalActions) + 0.0001)) * 100
    | sort bkt asc
    | limit 5000
  `;
}

// ===========================================================================
// Navigation & Flows — new queries for NavigationFlowsTab sub-tabs
// ===========================================================================

// ---------------------------------------------------------------------------
// Full geo metrics — includes Apdex components (sat/tol/fru) and Core Web
// Vitals per country. Used by GeoHeatmapSubTab and WorldMapSubTab.
// ---------------------------------------------------------------------------
export function geoFullQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and isNotNull(geo.country.iso_code)${filt}
    | fieldsAdd
        dur_ms = toDouble(duration) / 1000000.0,
        lcp_ms = toDouble(web_vitals.largest_contentful_paint) / 1000000.0,
        cls_v  = toDouble(web_vitals.cumulative_layout_shift),
        inp_ms = toDouble(web_vitals.interaction_to_next_paint) / 1000000.0,
        isSat  = dur_ms <= 1000,
        isTol  = dur_ms > 1000 and dur_ms <= 4000,
        isFru  = dur_ms > 4000
    | summarize
        sessions   = countDistinct(dt.rum.session.id),
        actions    = count(),
        avg_dur    = avg(dur_ms),
        errors     = countIf(characteristics.has_error == true),
        satisfied  = countIf(isSat),
        tolerating = countIf(isTol),
        frustrated = countIf(isFru),
        lcp_avg    = avg(if(isNotNull(web_vitals.largest_contentful_paint), lcp_ms)),
        cls_avg    = avg(if(isNotNull(web_vitals.cumulative_layout_shift), cls_v)),
        inp_avg    = avg(if(isNotNull(web_vitals.interaction_to_next_paint), inp_ms)),
        by: {country = geo.country.iso_code}
    | sort sessions desc
    | limit 300
  `;
}

// Bucketed version of geoFullQuery for WorldMapSubTab timelapse.
export function geoFullBucketedQuery(days: number, selected: string | null, bucketLabel?: string): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  const label = bucketLabel ?? bucketSizeForDays(days).label;
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and isNotNull(geo.country.iso_code)${filt}
    | fieldsAdd
        dur_ms = toDouble(duration) / 1000000.0,
        lcp_ms = toDouble(web_vitals.largest_contentful_paint) / 1000000.0,
        cls_v  = toDouble(web_vitals.cumulative_layout_shift),
        inp_ms = toDouble(web_vitals.interaction_to_next_paint) / 1000000.0,
        isSat  = dur_ms <= 1000,
        isTol  = dur_ms > 1000 and dur_ms <= 4000,
        isFru  = dur_ms > 4000,
        bkt    = bin(start_time, ${label})
    | summarize
        sessions   = countDistinct(dt.rum.session.id),
        actions    = count(),
        avg_dur    = avg(dur_ms),
        errors     = countIf(characteristics.has_error == true),
        satisfied  = countIf(isSat),
        tolerating = countIf(isTol),
        frustrated = countIf(isFru),
        lcp_avg    = avg(if(isNotNull(web_vitals.largest_contentful_paint), lcp_ms)),
        cls_avg    = avg(if(isNotNull(web_vitals.cumulative_layout_shift), cls_v)),
        inp_avg    = avg(if(isNotNull(web_vitals.interaction_to_next_paint), inp_ms)),
        by: {country = geo.country.iso_code, hour_bucket = bkt}
    | sort hour_bucket asc, sessions desc
    | limit 5000
  `;
}

// ---------------------------------------------------------------------------
// Sankey — user-journey page flow queries
// ---------------------------------------------------------------------------

// Primary Sankey flow: collectArray per session then aggregate s0-s4 counts.
export function sankeyFlowQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)${filt}
    | filter characteristics.classifier == "navigation" or characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary" or characteristics.classifier == "user_action"
    | fieldsAdd pageName = coalesce(view.name, view.url_path, "unknown")
    | sort timestamp asc
    | summarize path = collectArray(pageName), by: {dt.rum.session.id}
    | fieldsAdd pathLen = arraySize(path)
    | filter pathLen >= 2
    | fieldsAdd
        s0 = path[0], s1 = path[1],
        s2 = if(pathLen >= 3, path[2], else: "(exit)"),
        s3 = if(pathLen >= 4, path[3], else: "(exit)"),
        s4 = if(pathLen >= 5, path[4], else: "(exit)")
    | summarize sessions = count(), by: {s0, s1, s2, s3, s4}
    | sort sessions desc
    | limit 200
  `;
}

// Extended paths — full per-session path arrays for loop/endpoint/trends analysis.
export function sankeyExtendedPathsQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)${filt}
    | filter characteristics.classifier == "navigation" or characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary" or characteristics.classifier == "user_action"
    | fieldsAdd pageName = coalesce(view.name, view.url_path, "unknown")
    | sort timestamp asc
    | summarize path = collectArray(pageName), by: {dt.rum.session.id}
    | fieldsAdd pathLen = arraySize(path)
    | filter pathLen >= 2
    | limit 500
  `;
}

// Avg duration per page — for Page Timing sub-tab.
export function sankeyPageDurationQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)${filt}
    | filter characteristics.classifier == "navigation" or characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary" or characteristics.classifier == "user_action"
    | fieldsAdd pageName = coalesce(view.name, view.url_path, "unknown")
    | fieldsAdd dur_ms = toDouble(duration) / 1000000.0
    | summarize
        avgDuration = avg(dur_ms),
        p90Duration = percentile(dur_ms, 90),
        sessions    = count(),
        by: {pageName}
    | sort sessions desc
    | limit 50
  `;
}

// Previous-period extended paths — for Path Trends sub-tab comparison.
export function sankeyPrevPathsQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days, true)}
    | filter isNotNull(frontend.name)${filt}
    | filter characteristics.classifier == "navigation" or characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary" or characteristics.classifier == "user_action"
    | fieldsAdd pageName = coalesce(view.name, view.url_path, "unknown")
    | sort timestamp asc
    | summarize path = collectArray(pageName), by: {dt.rum.session.id}
    | fieldsAdd pathLen = arraySize(path)
    | filter pathLen >= 2
    | limit 500
  `;
}

// Timelapse — per-bucket path aggregations for the Sankey Flow Chart.
export function sankeyTimelapseQuery(days: number, selected: string | null, bucketLabel?: string): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  const label = bucketLabel ?? bucketSizeForDays(days).label;
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)${filt}
    | filter characteristics.classifier == "navigation" or characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary" or characteristics.classifier == "user_action"
    | fieldsAdd pageName = coalesce(view.name, view.url_path, "unknown")
    | fieldsAdd event_ts = coalesce(start_time, timestamp)
    | sort timestamp asc
    | summarize path = collectArray(pageName), session_start = min(event_ts), by: {dt.rum.session.id}
    | fieldsAdd pathLen = arraySize(path)
    | filter pathLen >= 2
    | fieldsAdd
        s0 = path[0], s1 = path[1],
        s2 = if(pathLen >= 3, path[2], else: "(exit)"),
        s3 = if(pathLen >= 4, path[3], else: "(exit)"),
        s4 = if(pathLen >= 5, path[4], else: "(exit)")
    | fieldsAdd bucket_ts = bin(session_start, ${label})
    | fieldsAdd bucket = formatTimestamp(bucket_ts, format: "yyyy-MM-dd HH:mm")
    | summarize sessions = count(), by: {bucket, s0, s1, s2, s3, s4}
    | sort bucket asc, sessions desc
    | summarize top_paths = arraySlice(collectArray(record(s0, s1, s2, s3, s4, sessions)), from: 0, to: 100), by: {bucket}
    | expand top_paths
    | fields
        bucket,
        s0 = top_paths[s0], s1 = top_paths[s1],
        s2 = top_paths[s2], s3 = top_paths[s3],
        s4 = top_paths[s4], sessions = top_paths[sessions]
    | sort bucket asc, sessions desc
    | limit 200000
  `;
}

// ---------------------------------------------------------------------------
// Session Replay Spotlight — sessions ranked by computed impact score.
// ---------------------------------------------------------------------------
export function sessionReplayQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and isNotNull(dt.rum.session.id)${filt}
    | fieldsAdd dur_ms = toDouble(duration) / 1000000.0
    | summarize
        err          = countIf(characteristics.has_error == true),
        navs         = countDistinct(coalesce(view.name, view.url_path)),
        interactions = countIf(characteristics.classifier == "user_action" or characteristics.classifier == "user_interaction"),
        dur_s        = sum(dur_ms) / 1000.0,
        device       = max(device.type),
        browser_name = max(browser.name),
        country      = max(geo.country.iso_code),
        start_time   = min(timestamp),
        by: {session_id = dt.rum.session.id, frontend_name = frontend.name}
    | fieldsAdd
        is_bounce    = navs <= 1,
        has_crash    = false,
        impact_score = toDouble(err) * 4.0 + if(is_bounce, 10.0, else: 0.0) + max(0.0, (dur_s - 30.0) / 10.0)
    | sort impact_score desc
    | limit 100
  `;
}
