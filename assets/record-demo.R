#!/usr/bin/env Rscript
# Desktop social demo: 1280 x 720, H.264 MP4, burned-in captions + WebVTT.
# From the repo root:
#   npm run sync:data   # only needed when static/data/changes.json is absent/stale
#   npm run build
#   Rscript assets/record-demo.R --check
#   Rscript assets/record-demo.R [assets/new-brew-demo.mp4]
# R dependencies: paparazzi (with recording/staging APIs), av, httpuv,
# jsonlite and curl. Chrome/Chromium must be available to chromote.
#
# The built dataset supplies real timeline rows. A temporary copy of the site
# freezes the clock at the snapshot date and seeds its already-synced cache.
# Featured package details are fetched before the take, then replayed locally.
# No app source, real browser profile, or production storage is changed.
# External-tab actions are captured and checked without opening distracting tabs.

required <- c("paparazzi", "av", "httpuv", "jsonlite", "curl")
missing <- required[
  !vapply(required, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing)) {
  stop(
    "Install required R packages: ",
    paste(missing, collapse = ", "),
    call. = FALSE
  )
}
library(paparazzi)

script_arg <- grep("^--file=", commandArgs(), value = TRUE)
if (!length(script_arg)) {
  stop("Run this script with Rscript.", call. = FALSE)
}
script <- normalizePath(sub("^--file=", "", script_arg[[1]]))
root <- dirname(dirname(script))
args <- commandArgs(trailingOnly = TRUE)
check_only <- "--check" %in% args
args <- args[args != "--check"]
if (length(args) > 1L) {
  stop("Usage: record-demo.R [output.mp4] [--check]", call. = FALSE)
}
output <- if (length(args)) {
  args[[1]]
} else {
  file.path(root, "assets", "new-brew-demo.mp4")
}
if (!tolower(tools::file_ext(output)) %in% c("mp4", "webm")) {
  stop(
    "Choose an .mp4 or .webm output (both support subtitle sidecars).",
    call. = FALSE
  )
}
dir.create(dirname(output), recursive = TRUE, showWarnings = FALSE)
output <- file.path(normalizePath(dirname(output)), basename(output))
poster <- sub("\\.[^.]+$", "-poster.png", output)

locate_button <- function(text, css = "button") pz_loc(css, has_text = text)

add_caption <- function(page, text, hold = 1.5) {
  page |>
    pz_annotate_caption(text, side = "bottom", font_size = 24) |>
    pz_record_hold(hold) |>
    # Advance the capture clock so a following caption cannot replace this
    # one at the same timestamp (holds alone do not run the browser).
    pz_wait(0.15)
}

pick_window <- function(page, label) {
  page |>
    pz_act_click(".since-trigger") |>
    pz_expect_visible(".since-pop") |>
    pz_act_click(locate_button(paste0("[", label, "]"), ".since-opt")) |>
    pz_expect_hidden(".since-pop") |>
    pz_expect_text(label, target = ".since-trigger")
}

click_chip <- function(page, label, active) {
  target <- locate_button(paste0("[", label, "]"), ".chip")
  page |>
    pz_act_click(target) |>
    pz_expect_js(
      paste0(
        "el => el.getAttribute('aria-pressed') === '",
        tolower(active),
        "'"
      ),
      target = target
    )
}

search_for <- function(page, text) {
  page |>
    pz_act_press("/") |>
    pz_expect_focused(".search") |>
    pz_act_type(text) |>
    pz_expect_value(text, target = ".search", match = "exact") |>
    pz_expect_class("busy", target = ".searchbox", not = TRUE)
}

clear_search <- function(page) {
  page |>
    pz_set_value("", target = ".search") |>
    pz_expect_value("", target = ".search", match = "exact") |>
    pz_expect_class("busy", target = ".searchbox", not = TRUE) |>
    pz_act_press("Tab", show_keys = "none") |>
    pz_expect_focused(".search", not = TRUE)
}

select_package <- function(page, key, name) {
  page |>
    pz_act_click(paste0('.row[data-key="', key, '"] .line')) |>
    pz_expect_text(name, target = ".card.current h2", match = "exact") |>
    pz_expect_visible(".card.current .card-install")
}

expect_selected_details <- function(page) {
  name <- pz_get_text(page, target = ".row.selected .name")
  page |>
    pz_expect_text(name, target = ".card.current h2", match = "exact") |>
    pz_expect_visible(".card.current .card-install")
}

browse_with_keys <- function(page) {
  before <- pz_get_attr(page, "data-key", target = ".row.selected")
  page |>
    pz_expect_count(min = 3, target = ".row") |>
    pz_act_press("j") |>
    expect_selected_details() |>
    pz_record_hold(1) |>
    pz_act_press("j") |>
    expect_selected_details() |>
    pz_expect_js(
      paste0(
        "el => el.dataset.key !== ",
        jsonlite::toJSON(before, auto_unbox = TRUE)
      ),
      target = ".row.selected"
    ) |>
    pz_record_hold(1.5) |>
    pz_act_press("k") |>
    expect_selected_details() |>
    pz_record_hold(1) |>
    pz_act_press("k") |>
    expect_selected_details() |>
    pz_expect_js(
      paste0(
        "el => el.dataset.key === ",
        jsonlite::toJSON(before, auto_unbox = TRUE)
      ),
      target = ".row.selected"
    )
}

toggle_pin <- function(page, pinned, count) {
  page |>
    pz_act_press("p") |>
    pz_expect_text(
      if (pinned) "[unpin]" else "[pin]",
      target = ".card.current .pin",
      match = "exact"
    ) |>
    pz_expect_count(count, target = '.card .pin[aria-pressed="true"]')
}

run_walkthrough <- function(page, pinned_urls) {
  page |>
    add_caption("New brew · what's new in Homebrew since your last visit", 2) |>

    add_caption("Catch up on this week's changes") |>
    pz_camera(
      pz_frame(".since-wrap", zoom = 1.8, anchor = "top", pad = 16),
      wait = TRUE
    ) |>
    pick_window("this week") |>
    pz_camera_reset(wait = FALSE) |>

    add_caption("Browse with j/k · package details follow your selection") |>
    click_chip("formulae", TRUE) |>
    pz_expect_text("formula", target = ".row .type", match = "exact") |>
    browse_with_keys() |>

    search_for("go") |>
    select_package("f/go", "go") |>
    pz_record_hold(1) |>
    add_caption("Press p to pin · press it again to unpin") |>
    pz_camera(
      pz_frame(".card.current", zoom = 1.45, anchor = "top right", pad = 16)
    ) |>
    pz_expect_text("license", target = ".card.current .card-rows") |>
    # Settle the push-in before showing the pin/unpin state changes.
    pz_record_hold(1) |>
    toggle_pin(TRUE, 1) |>
    pz_record_hold(1) |>
    pz_wait(1) |>
    toggle_pin(FALSE, 0) |>
    pz_record_hold(1) |>
    pz_wait(1) |>
    toggle_pin(TRUE, 1) |>
    pz_record_hold(1) |>
    pz_wait(1) |>
    pz_camera_reset(wait = FALSE) |>

    clear_search() |>
    click_chip("formulae", FALSE) |>
    add_caption("Press / to find the app you're looking for") |>
    search_for("positron") |>
    select_package("c/positron", "positron") |>
    pz_record_hold(1) |>
    add_caption("Package details and a copyable install command, right here") |>
    # Follow the pointer into the card while the copy interaction begins.
    pz_camera(
      pz_frame(".card.current", zoom = 1.45, anchor = "top right", pad = 16),
      wait = FALSE
    ) |>
    pz_expect_text("requires", target = ".card.current .card-rows") |>
    pz_expect_text(
      "brew install --cask positron",
      target = ".card.current .install",
      match = "exact"
    ) |>
    pz_act_click(".card.current .copy") |>
    pz_expect_text("copied", target = ".card.current .copy") |>
    pz_record_hold(1) |>
    toggle_pin(TRUE, 2) |>
    pz_expect_text("2 pinned", target = ".sidebar-head") |>
    pz_camera_reset(wait = TRUE) |>

    add_caption("Keep a shortlist · open every pinned project in one click") |>
    pz_expect_count(2, target = '.card .pin[aria-pressed="true"]') |>
    pz_act_click(".open-all") |>
    pz_expect_js(
      paste0(
        "() => window.__demoOpened.length === 2 && ",
        jsonlite::toJSON(unname(pinned_urls), auto_unbox = FALSE),
        ".every(url => window.__demoOpened.includes(url))"
      )
    ) |>
    pz_record_hold(1) |>

    add_caption("Light or dark · make it yours") |>
    pz_act_click(".theme-toggle") |>
    pz_expect_js("() => document.documentElement.dataset.theme === 'light'") |>
    pz_wait(0.7) |> # Let the 550ms theme wipe finish before freezing a frame.
    pz_record_hold(1.5) |>
    add_caption("New brew · scan changes, find a package, keep a shortlist", 3)
}

run_demo <- function() {
  build <- file.path(root, "build")
  dataset_path <- file.path(build, "data", "changes.json")
  if (
    !file.exists(file.path(build, "index.html")) || !file.exists(dataset_path)
  ) {
    stop(
      "Build/data missing. Run npm run sync:data, then npm run build.",
      call. = FALSE
    )
  }
  dataset <- jsonlite::fromJSON(dataset_path, simplifyVector = FALSE)
  keys <- vapply(dataset$items, function(x) paste0(x$t, "/", x$n), character(1))
  featured <- c("f/go", "c/positron")
  if (!all(featured %in% keys)) {
    stop(
      "This snapshot must contain go and positron. Refresh with npm run sync:data and npm run build."
    )
  }
  pinned_urls <- vapply(
    dataset$items[match(featured, keys)],
    `[[`,
    character(1),
    "url"
  )
  snapshot_date <- as.Date(substr(dataset$generated_at, 1, 10))
  featured_dates <- as.Date(vapply(
    dataset$items[match(featured, keys)],
    `[[`,
    character(1),
    "d"
  ))
  week_start <- snapshot_date - (as.integer(format(snapshot_date, "%u")) - 1L)
  if (any(featured_dates < week_start)) {
    stop(
      "Featured packages are outside this week's window. Refresh the data or choose newer packages."
    )
  }
  message("Timeline snapshot: ", dataset$generated_at)

  # Fetch before recording: a slow/unavailable API fails early, not mid-take.
  # Cache the first three formulae too: j/k should show loaded cards, not
  # network-dependent spinners, as it moves through these rows.
  browse_keys <- keys[vapply(
    dataset$items,
    function(item) {
      item$t == "f" && item$d >= as.character(week_start)
    },
    logical(1)
  )]
  detail_keys <- unique(c(featured, head(browse_keys, 3), keys[[1]]))
  details <- setNames(
    lapply(detail_keys, function(key) {
      parts <- strsplit(key, "/", fixed = TRUE)[[1]]
      kind <- if (parts[[1]] == "f") "formula" else "cask"
      url <- paste0(
        "https://formulae.brew.sh/api/",
        kind,
        "/",
        parts[[2]],
        ".json"
      )
      message("Caching details: ", url)
      response <- curl::curl_fetch_memory(
        url,
        handle = curl::new_handle(timeout = 30)
      )
      if (response$status_code != 200L) {
        stop("Homebrew API returned ", response$status_code, ": ", url)
      }
      jsonlite::fromJSON(rawToChar(response$content), simplifyVector = FALSE)
    }),
    sub("^c/", "cask/", sub("^f/", "formula/", detail_keys))
  )

  site <- tempfile("new-brew-demo-")
  dir.create(site)
  on.exit(unlink(site, recursive = TRUE), add = TRUE)
  files <- list.files(build, all.files = TRUE, full.names = TRUE, no.. = TRUE)
  if (!all(file.copy(files, site, recursive = TRUE))) {
    stop("Could not copy the build.")
  }
  cache <- list(
    v = 1,
    identity = dataset[c("generated_at", "core_head_sha", "cask_head_sha")],
    retentionDays = dataset$retention_days,
    synced = list(core = dataset$core_head_sha, cask = dataset$cask_head_sha),
    partial = list(core = NULL, cask = NULL),
    items = dataset$items
  )
  encode_json <- function(x) {
    as.character(jsonlite::toJSON(
      x,
      auto_unbox = TRUE,
      null = "null",
      digits = NA
    ))
  }
  bootstrap <- paste0(
    "<script>\n",
    "const NativeDate = Date; const demoNow = NativeDate.parse('",
    snapshot_date,
    "T12:00:00Z');\n",
    "window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [demoNow])); } static now() { return demoNow; } };\n",
    "localStorage.removeItem('newbrew:theme'); localStorage.removeItem('newbrew:filter');\n",
    "localStorage.setItem('newbrew:lastVisit', String(demoNow - 2 * 86400000));\n",
    "localStorage.setItem('newbrew:cache:v1', JSON.stringify(",
    encode_json(cache),
    "));\n",
    "const demoDetails = ",
    encode_json(details),
    "; const realFetch = window.fetch.bind(window);\n",
    "window.fetch = (input, options) => { const url = (input && input.url) || String(input); const key = url.replace('https://formulae.brew.sh/api/', '').replace(/\\.json$/, ''); return demoDetails[key] ? Promise.resolve(new Response(JSON.stringify(demoDetails[key]), {status: 200, headers: {'Content-Type': 'application/json'}})) : realFetch(input, options); };\n",
    "window.__demoOpened = []; window.open = (url) => { window.__demoOpened.push(String(url)); return null; };\n",
    "</script>\n"
  )
  # JSON strings are embedded in HTML; prevent text containing </script> from
  # terminating the bootstrap (descriptions/caveats come from external data).
  bootstrap <- sub("</script>\\n$", "", bootstrap)
  bootstrap <- gsub("</", "<\\/", bootstrap, fixed = TRUE)
  bootstrap <- paste0(bootstrap, "</script>\n")
  index <- file.path(site, "index.html")
  html <- paste(readLines(index, warn = FALSE), collapse = "\n")
  if (
    !grepl("<head>", html, fixed = TRUE) ||
      !grepl("</head>", html, fixed = TRUE)
  ) {
    stop(
      "Build HTML changed: cannot inject the demo bootstrap/safe-area styles."
    )
  }
  html <- sub("<head>", paste0("<head>\n", bootstrap), html, fixed = TRUE)
  # Enable the caption safe area only after capturing the README poster.
  html <- sub(
    "</head>",
    paste0(
      '<style id="demo-safe-area" media="not all">',
      ".shell { height: calc(100dvh - 72px); } ",
      ".sidebar { max-height: calc(100vh - 112px); }</style></head>"
    ),
    html,
    fixed = TRUE
  )
  writeLines(html, index)

  pz_with_page(
    site,
    function(page) {
      page |>
        pz_expect_js(
          "() => Date.now() === demoNow && Array.isArray(window.__demoOpened)"
        ) |>
        pz_expect_visible(".shell") |>
        pz_expect_count(min = 2, target = ".row") |>
        pz_expect_visible(".card.current .card-install") |>
        pz_stage(
          enter = "top",
          camera_follow = FALSE,
          cursor_speed = 1000,
          cursor_scale = 1.25,
          typing = "natural",
          typing_speed = 28,
          pause = 0.15,
          click_effect = "ring",
          click_effect_color = "#e9ad57",
          show_keys = "both"
        )
      # Keep the README poster caption-free and at the normal full height.
      page |> pz_screenshot(poster)
      pz_js(page, "document.getElementById('demo-safe-area').media = 'all'")
      page |>
        pz_expect_js(
          "el => Math.round(el.getBoundingClientRect().height) === window.innerHeight - 72",
          target = ".shell"
        )
      # Capture at 2x density for sharp zooms; the finished video stays 720p.
      page |>
        pz_device(scale = 2) |>
        add_caption("New brew · what's new in Homebrew since your last visit")
      if (check_only) {
        page |> run_walkthrough(pinned_urls)
        message("Walkthrough checks passed. Poster: ", poster)
      } else {
        page |>
          pz_record(
            output,
            code = page |> run_walkthrough(pinned_urls),
            fps = 24,
            scale = 1280,
            hold = c(0.3, 1),
            captions = "both"
          )
        message(
          "Recording: ",
          output,
          "\nSubtitles: ",
          sub("\\.[^.]+$", ".vtt", output),
          "\nPoster: ",
          poster
        )
      }
    },
    width = 1280,
    height = 720,
    scale = 1,
    color_scheme = "dark",
    locale = "en-US",
    timezone = "UTC",
    timeout = 20
  )
}

run_demo()
