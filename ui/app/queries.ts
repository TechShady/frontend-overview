import { periodClause, webAppFilterClause } from "./SettingsContext";

// ---------------------------------------------------------------------------
// Every query in this module aggregates by `application` (web app name).
// A single-web-app filter can be applied via the `selected` parameter.
// ---------------------------------------------------------------------------

// Discover every web app in the tenant (used to populate the filter dropdown).
export function webAppInventoryQuery(days: number): string {
  return `
    fetch usersession, ${periodClause(days)}
    | filter isNotNull(application)
    | summarize sessions = count(), users = countDistinctExact(userId), by:{application}
    | sort sessions desc
    | limit 200
  `;
}

// Executive Summary — per web app aggregate for grading.
export function webAppSummaryQuery(days: number, selected: string | null, prev = false): string {
  return `
    fetch usersession, ${periodClause(days, prev)}
    | filter isNotNull(application)${webAppFilterClause(selected)}
    | summarize
        sessions = count(),
        users = countDistinctExact(userId),
        actions = sum(userActionCount),
        errors = sum(errorCount),
        avgDuration = avg(duration),
        bounces = countIf(userActionCount <= 1),
        newUsers = countIf(userType == "NEW_USER"),
        by:{application}
    | fieldsAdd errorRate = (toDouble(errors) / (toDouble(actions) + 0.0001)) * 100
    | fieldsAdd bounceRate = (toDouble(bounces) / (toDouble(sessions) + 0.0001)) * 100
    | sort sessions desc
    | limit 200
  `;
}

// Core Web Vitals (RUM metrics) per web app — average.
export function webVitalsPerAppQuery(days: number, selected: string | null): string {
  const filt = selected ? ` | filter dt.entity.application != "" and application_name == "${selected.replace(/"/g, '\\"')}"` : "";
  return `
    timeseries {
      lcp = avg(dt.rum.largest_contentful_paint),
      cls = avg(dt.rum.cumulative_layout_shift),
      inp = avg(dt.rum.interaction_to_next_paint),
      ttfb = avg(dt.rum.time_to_first_byte)
    },
    by:{dt.entity.application},
    ${periodClause(days)}
    | fieldsAdd application_name = entityName(dt.entity.application)
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

// Web vitals fallback — computes from user actions when metric series are absent.
export function webVitalsFromEventsQuery(days: number, selected: string | null): string {
  return `
    fetch usersession, ${periodClause(days)}
    | filter isNotNull(application)${webAppFilterClause(selected)}
    | summarize
        lcpAvg = avg(userExperienceScore),
        actions = sum(userActionCount),
        sessions = count(),
        by:{application}
    | sort sessions desc
    | limit 200
  `;
}

// Failure / error rate per web app — % of failed actions.
export function errorsPerAppQuery(days: number, selected: string | null, prev = false): string {
  return `
    fetch usersession, ${periodClause(days, prev)}
    | filter isNotNull(application)${webAppFilterClause(selected)}
    | summarize
        totalActions = sum(userActionCount),
        totalErrors = sum(errorCount),
        sessions = count(),
        errSessions = countIf(errorCount > 0),
        by:{application}
    | fieldsAdd
        errorRate = (toDouble(totalErrors) / (toDouble(totalActions) + 0.0001)) * 100,
        errSessionsPct = (toDouble(errSessions) / (toDouble(sessions) + 0.0001)) * 100
    | sort errorRate desc
    | limit 200
  `;
}

// Top pages per web app (navigation flows without any journey concept).
export function topPagesQuery(days: number, selected: string | null): string {
  return `
    fetch dt.rum.action, ${periodClause(days)}
    | filter isNotNull(application) and isNotNull(name)${webAppFilterClause(selected)}
    | summarize
        views = count(),
        avgDuration = avg(duration),
        errors = sum(if(errorCount > 0, errorCount, 0)),
        by:{application, name, type}
    | sort views desc
    | limit 500
  `;
}

// Page transitions — actual navigation flows per web app. Uses a self-lookup
// on session id to derive "next page" from consecutive actions.
export function pageTransitionsQuery(days: number, selected: string | null): string {
  return `
    fetch dt.rum.action, ${periodClause(days)}
    | filter isNotNull(application) and isNotNull(name)${webAppFilterClause(selected)}
    | sort sessionId asc, startTime asc
    | fields application, sessionId, page = name, ts = startTime
    | fieldsAdd nextPage = shift(page, by:-1, defaultValue:""), nextSession = shift(sessionId, by:-1, defaultValue:"")
    | filter sessionId == nextSession and nextPage != "" and nextPage != page
    | summarize transitions = count(), by:{application, page, nextPage}
    | sort transitions desc
    | limit 500
  `;
}

// Resource consumption per web app — total bytes/requests. Core of the "who's
// consuming the most" story.
export function resourceConsumptionQuery(days: number, selected: string | null): string {
  return `
    fetch dt.rum.action, ${periodClause(days)}
    | filter isNotNull(application)${webAppFilterClause(selected)}
    | summarize
        pageViews = count(),
        totalBytes = sum(coalesce(networkBytes, 0)),
        totalRequests = sum(coalesce(networkRequests, 0)),
        avgBytesPerView = avg(coalesce(networkBytes, 0)),
        avgRequestsPerView = avg(coalesce(networkRequests, 0)),
        avgDomComplete = avg(coalesce(domCompleteTime, 0)),
        by:{application}
    | sort totalBytes desc
    | limit 200
  `;
}

// Third-party impact per web app — inferred from action resource metadata.
export function thirdPartyImpactQuery(days: number, selected: string | null): string {
  return `
    fetch dt.rum.action, ${periodClause(days)}
    | filter isNotNull(application)${webAppFilterClause(selected)}
    | summarize
        totalActions = count(),
        totalBytes = sum(coalesce(networkBytes, 0)),
        thirdPartyBytes = sum(coalesce(thirdPartyBytes, 0)),
        thirdPartyRequests = sum(coalesce(thirdPartyRequests, 0)),
        by:{application}
    | fieldsAdd
        thirdPartyBytesPct = (toDouble(thirdPartyBytes) / (toDouble(totalBytes) + 0.0001)) * 100
    | sort thirdPartyBytesPct desc
    | limit 200
  `;
}

// Traffic timeseries per web app — used for sparklines and trend view.
export function trafficTimeseriesQuery(days: number, selected: string | null): string {
  return `
    timeseries sessions = count(),
      by:{dt.entity.application},
      filter:{event.kind == "RUM_EVENT"},
      ${periodClause(days)}
    | fieldsAdd application_name = entityName(dt.entity.application)
    ${selected ? ` | filter application_name == "${selected.replace(/"/g, '\\"')}"` : ""}
    | limit 200
  `;
}

// Session-count timeseries as fallback (event-based, not metric-based).
export function sessionsTimeseriesQuery(days: number, selected: string | null): string {
  return `
    fetch usersession, ${periodClause(days)}
    | filter isNotNull(application)${webAppFilterClause(selected)}
    | makeTimeseries sessions = count(), by:{application}, time:startTime, interval:auto
    | limit 200
  `;
}

// Geo breakdown per web app.
export function geoPerAppQuery(days: number, selected: string | null): string {
  return `
    fetch usersession, ${periodClause(days)}
    | filter isNotNull(application) and isNotNull(country)${webAppFilterClause(selected)}
    | summarize
        sessions = count(),
        users = countDistinctExact(userId),
        errors = sum(errorCount),
        avgDuration = avg(duration),
        by:{application, country}
    | sort sessions desc
    | limit 1000
  `;
}

// Devices / browsers per web app.
export function deviceBreakdownQuery(days: number, selected: string | null): string {
  return `
    fetch usersession, ${periodClause(days)}
    | filter isNotNull(application)${webAppFilterClause(selected)}
    | summarize
        sessions = count(),
        errors = sum(errorCount),
        avgDuration = avg(duration),
        by:{application, browserFamily, osFamily, deviceType = if(isNotNull(devicetype), devicetype, "Unknown")}
    | sort sessions desc
    | limit 500
  `;
}

// JS errors per web app.
export function jsErrorsQuery(days: number, selected: string | null): string {
  return `
    fetch dt.rum.error, ${periodClause(days)}
    | filter isNotNull(application)${webAppFilterClause(selected)}
    | summarize
        errors = count(),
        affectedSessions = countDistinctExact(sessionId),
        by:{application, errorMessage = coalesce(errorMessage, name, "Unknown")}
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
