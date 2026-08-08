import { periodClause, webAppFilterClause } from "./SettingsContext";

// Every query aggregates by `application` — actual DQL field is `frontend.name`
// (or `dt.entity.application` for metrics). Consumers use `application` uniformly.

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

// Per-web-app aggregate for grading.
export function webAppSummaryQuery(days: number, selected: string | null, prev = false): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days, prev)}
    | filter isNotNull(frontend.name)${filt}
    | summarize
        sessions = countDistinct(dt.rum.session.id),
        users = countDistinct(dt.rum.user.id),
        actions = count(),
        errors = countIf(event.type == "ERROR"),
        avgDuration = avg(duration),
        by:{application = frontend.name}
    | fieldsAdd errorRate = (toDouble(errors) / (toDouble(actions) + 0.0001)) * 100
    | sort sessions desc
    | limit 200
  `;
}

// Core Web Vitals per web app — metric-based.
export function webVitalsPerAppQuery(days: number, selected: string | null): string {
  const filt = selected ? ` | filter application == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    timeseries {
      lcp = avg(dt.rum.largest_contentful_paint),
      cls = avg(dt.rum.cumulative_layout_shift),
      inp = avg(dt.rum.interaction_to_next_paint),
      ttfb = avg(dt.rum.time_to_first_byte)
    },
    by:{dt.entity.application},
    ${periodClause(days)}
    | fieldsAdd application = entityName(dt.entity.application)
    ${filt}
    | fieldsAdd
        lcpAvg = arrayAvg(lcp),
        clsAvg = arrayAvg(cls),
        inpAvg = arrayAvg(inp),
        ttfbAvg = arrayAvg(ttfb)
    | sort lcpAvg desc
    | limit 200
  `;
}

// Fallback: computed from user events when metrics are absent.
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
        totalActions = count(),
        totalErrors = countIf(event.type == "ERROR"),
        sessions = countDistinct(dt.rum.session.id),
        errSessions = countDistinct(if(event.type == "ERROR", dt.rum.session.id)),
        by:{application = frontend.name}
    | fieldsAdd
        errorRate = (toDouble(totalErrors) / (toDouble(totalActions) + 0.0001)) * 100,
        errSessionsPct = (toDouble(errSessions) / (toDouble(sessions) + 0.0001)) * 100
    | sort errorRate desc
    | limit 200
  `;
}

// Top pages per web app.
export function topPagesQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and isNotNull(view.name) and event.type == "ACTION"${filt}
    | summarize
        views = count(),
        avgDuration = avg(duration),
        by:{application = frontend.name, name = view.name}
    | sort views desc
    | limit 500
  `;
}

// Page transitions — actual navigation flows per web app.
export function pageTransitionsQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and isNotNull(view.name) and event.type == "ACTION"${filt}
    | sort dt.rum.session.id asc, timestamp asc
    | fields application = frontend.name, sessionId = dt.rum.session.id, page = view.name, ts = timestamp
    | fieldsAdd nextPage = shift(page, by:-1, defaultValue:""), nextSession = shift(sessionId, by:-1, defaultValue:"")
    | filter sessionId == nextSession and nextPage != "" and nextPage != page
    | summarize transitions = count(), by:{application, page, nextPage}
    | sort transitions desc
    | limit 500
  `;
}

// Resource consumption per web app.
export function resourceConsumptionQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and event.type == "LOAD"${filt}
    | summarize
        pageViews = count(),
        totalBytes = sum(coalesce(view.network.bytes, 0)),
        totalRequests = sum(coalesce(view.network.requests, 0)),
        avgBytesPerView = avg(coalesce(view.network.bytes, 0)),
        avgRequestsPerView = avg(coalesce(view.network.requests, 0)),
        avgDomComplete = avg(coalesce(view.dom_complete, 0)),
        by:{application = frontend.name}
    | sort totalBytes desc
    | limit 200
  `;
}

// Third-party impact per web app.
export function thirdPartyImpactQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and event.type == "LOAD"${filt}
    | summarize
        totalActions = count(),
        totalBytes = sum(coalesce(view.network.bytes, 0)),
        thirdPartyBytes = sum(coalesce(view.third_party.bytes, 0)),
        thirdPartyRequests = sum(coalesce(view.third_party.requests, 0)),
        by:{application = frontend.name}
    | fieldsAdd
        thirdPartyBytesPct = (toDouble(thirdPartyBytes) / (toDouble(totalBytes) + 0.0001)) * 100
    | sort thirdPartyBytesPct desc
    | limit 200
  `;
}

// Traffic timeseries per web app.
export function trafficTimeseriesQuery(days: number, selected: string | null): string {
  const filt = selected ? ` | filter application == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    timeseries sessions = count(),
      by:{dt.entity.application},
      filter:{event.kind == "RUM_EVENT"},
      ${periodClause(days)}
    | fieldsAdd application = entityName(dt.entity.application)
    ${filt}
    | limit 200
  `;
}

// Session-count timeseries fallback (event-based).
export function sessionsTimeseriesQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and event.type == "LOAD"${filt}
    | makeTimeseries sessions = countDistinct(dt.rum.session.id), by:{application = frontend.name}, time:timestamp, interval:auto
    | limit 200
  `;
}

// Geo breakdown per web app.
export function geoPerAppQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and isNotNull(geolocation.country)${filt}
    | summarize
        sessions = countDistinct(dt.rum.session.id),
        users = countDistinct(dt.rum.user.id),
        errors = countIf(event.type == "ERROR"),
        avgDuration = avg(duration),
        by:{application = frontend.name, country = geolocation.country}
    | sort sessions desc
    | limit 1000
  `;
}

// Devices / browsers per web app.
export function deviceBreakdownQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name)${filt}
    | summarize
        sessions = countDistinct(dt.rum.session.id),
        errors = countIf(event.type == "ERROR"),
        avgDuration = avg(duration),
        by:{
          application = frontend.name,
          browserFamily = coalesce(user_agent.family, "Unknown"),
          osFamily = coalesce(os.name, "Unknown"),
          deviceType = coalesce(device.type, "Unknown")
        }
    | sort sessions desc
    | limit 500
  `;
}

// JS errors per web app.
export function jsErrorsQuery(days: number, selected: string | null): string {
  const filt = selected ? ` and frontend.name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    fetch user.events, ${periodClause(days)}
    | filter isNotNull(frontend.name) and event.type == "ERROR"${filt}
    | summarize
        errors = count(),
        affectedSessions = countDistinct(dt.rum.session.id),
        by:{application = frontend.name, errorMessage = coalesce(error.message, error.name, "Unknown")}
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
