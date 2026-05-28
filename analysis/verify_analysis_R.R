#!/usr/bin/env Rscript
#
# Independent Replication of Potomac Pulse Analyses in R
# Cross-validates Python results with independent implementation
#
# Outputs: verify_results_R.csv (model fit results for cross-language comparison)

library(readr)
library(dplyr, warn.conflicts = FALSE)
library(httr)
library(jsonlite)

BASE <- "/Users/sebjilke/Desktop/PotomacPulse/analysis"
results <- list()

cat(strrep("=", 70), "\n")
cat("R INDEPENDENT REPLICATION — POWER-LAW MODEL FIT\n")
cat(strrep("=", 70), "\n\n")

# ============================================================
# 1. LOAD AND VERIFY ef_lf_daily_longterm.csv
# ============================================================
cat("1. Loading ef_lf_daily_longterm.csv...\n")
df <- read_csv(file.path(BASE, "ef_lf_daily_longterm.csv"),
               col_types = cols(date = col_character(),
                                ef_stage = col_double(),
                                lf_discharge = col_double()),
               show_col_types = FALSE)

cat(sprintf("   Rows: %d\n", nrow(df)))
cat(sprintf("   Unique dates: %d\n", n_distinct(df$date)))
cat(sprintf("   EF stage range: %.2f to %.2f\n", min(df$ef_stage), max(df$ef_stage)))
cat(sprintf("   LF discharge range: %.0f to %.0f\n", min(df$lf_discharge), max(df$lf_discharge)))

# Check for duplicate dates
dupes <- df %>% count(date) %>% filter(n > 1)
cat(sprintf("   Dates with >1 row: %d (DUPLICATES DETECTED)\n\n", nrow(dupes)))

# ============================================================
# 2. FIT ON RAW (DUPLICATED) DATA — for comparison with Python
# ============================================================
cat(strrep("-", 70), "\n")
cat("2a. Power-law fit on RAW data (including duplicates, n=", nrow(df), ")\n")
cat(strrep("-", 70), "\n")

fit_raw <- lm(log(lf_discharge) ~ log(ef_stage), data = df)
coef_raw <- exp(coef(fit_raw)[1])
exp_raw <- coef(fit_raw)[2]
r2_raw <- summary(fit_raw)$r.squared
pred_raw <- coef_raw * (df$ef_stage ^ exp_raw)
rmse_raw <- sqrt(mean((df$lf_discharge - pred_raw)^2))
mean_err_pct_raw <- mean(100 * (pred_raw - df$lf_discharge) / df$lf_discharge)

cat(sprintf("   Model: LF = %.1f × EF^%.3f\n", coef_raw, exp_raw))
cat(sprintf("   R² = %.6f\n", r2_raw))
cat(sprintf("   RMSE = %.1f cfs\n", rmse_raw))
cat(sprintf("   Mean error %% = %.2f%%\n", mean_err_pct_raw))
cat(sprintf("   N = %d\n\n", nrow(df)))

results$default_coef <- round(coef_raw, 4)
results$default_exp <- round(exp_raw, 6)
results$default_r2 <- round(r2_raw, 6)
results$default_rmse <- round(rmse_raw, 4)
results$default_n <- nrow(df)
results$default_mean_err_pct <- round(mean_err_pct_raw, 4)

# ============================================================
# 2b. FIT ON DEDUPLICATED DATA — mean EF stage per date
# ============================================================
cat(strrep("-", 70), "\n")
cat("2b. Power-law fit on DEDUPLICATED data (mean EF per date)\n")
cat(strrep("-", 70), "\n")

df_dedup <- df %>%
  group_by(date) %>%
  summarise(ef_stage = mean(ef_stage),
            lf_discharge = first(lf_discharge),
            .groups = "drop")

cat(sprintf("   Deduplicated rows: %d\n", nrow(df_dedup)))

fit_dedup <- lm(log(lf_discharge) ~ log(ef_stage), data = df_dedup)
coef_dedup <- exp(coef(fit_dedup)[1])
exp_dedup <- coef(fit_dedup)[2]
r2_dedup <- summary(fit_dedup)$r.squared
pred_dedup <- coef_dedup * (df_dedup$ef_stage ^ exp_dedup)
rmse_dedup <- sqrt(mean((df_dedup$lf_discharge - pred_dedup)^2))

cat(sprintf("   Model: LF = %.1f × EF^%.3f\n", coef_dedup, exp_dedup))
cat(sprintf("   R² = %.6f\n", r2_dedup))
cat(sprintf("   RMSE = %.1f cfs\n", rmse_dedup))
cat(sprintf("   N = %d\n\n", nrow(df_dedup)))

results$dedup_coef <- round(coef_dedup, 4)
results$dedup_exp <- round(exp_dedup, 6)
results$dedup_r2 <- round(r2_dedup, 6)
results$dedup_rmse <- round(rmse_dedup, 4)
results$dedup_n <- nrow(df_dedup)

# ============================================================
# 3. COLD-WATER MODEL
# ============================================================
cat(strrep("-", 70), "\n")
cat("3. Cold-water model fit (ef_temp_c <= 10°C)\n")
cat(strrep("-", 70), "\n")

df_temp <- read_csv(file.path(BASE, "ef_lf_temp_merged.csv"),
                    col_types = cols(date = col_character(),
                                     ef_stage = col_double(),
                                     lf_discharge = col_double(),
                                     ef_temp_c = col_double()),
                    show_col_types = FALSE)

cat(sprintf("   Temp-merged rows: %d\n", nrow(df_temp)))
cat(sprintf("   Unique dates: %d\n", n_distinct(df_temp$date)))

# Check for duplicates in temp file
temp_dupes <- df_temp %>% count(date) %>% filter(n > 1)
cat(sprintf("   Dates with >1 row: %d\n", nrow(temp_dupes)))

# If duplicates, deduplicate by mean
if (nrow(temp_dupes) > 0) {
  df_temp_dedup <- df_temp %>%
    group_by(date) %>%
    summarise(ef_stage = mean(ef_stage),
              lf_discharge = first(lf_discharge),
              ef_temp_c = mean(ef_temp_c),
              .groups = "drop")
  cat(sprintf("   After dedup: %d rows\n", nrow(df_temp_dedup)))
} else {
  df_temp_dedup <- df_temp
}

cold <- df_temp_dedup %>% filter(ef_temp_c <= 10)
cat(sprintf("   Cold-water observations: %d\n", nrow(cold)))

if (nrow(cold) > 50) {
  fit_cold <- lm(log(lf_discharge) ~ log(ef_stage), data = cold)
  coef_cold <- exp(coef(fit_cold)[1])
  exp_cold <- coef(fit_cold)[2]
  r2_cold <- summary(fit_cold)$r.squared
  pred_cold <- coef_cold * (cold$ef_stage ^ exp_cold)
  rmse_cold <- sqrt(mean((cold$lf_discharge - pred_cold)^2))

  cat(sprintf("   Model: LF = %.1f × EF^%.3f\n", coef_cold, exp_cold))
  cat(sprintf("   R² = %.6f\n", r2_cold))
  cat(sprintf("   RMSE = %.1f cfs\n\n", rmse_cold))

  results$cold_coef <- round(coef_cold, 4)
  results$cold_exp <- round(exp_cold, 6)
  results$cold_r2 <- round(r2_cold, 6)
  results$cold_rmse <- round(rmse_cold, 4)
  results$cold_n <- nrow(cold)
}

# ============================================================
# 4. FLOW-REGIME ERROR ANALYSIS
# ============================================================
cat(strrep("-", 70), "\n")
cat("4. Error by flow regime (using raw data for comparability)\n")
cat(strrep("-", 70), "\n\n")

df <- df %>% mutate(
  predicted = coef_raw * (ef_stage ^ exp_raw),
  error_pct = 100 * (predicted - lf_discharge) / lf_discharge
)

regimes <- list(
  "Very Low (<2000 cfs)" = df$lf_discharge < 2000,
  "Low (2000-5000 cfs)" = df$lf_discharge >= 2000 & df$lf_discharge < 5000,
  "Medium (5000-15000 cfs)" = df$lf_discharge >= 5000 & df$lf_discharge < 15000,
  "High (15000-30000 cfs)" = df$lf_discharge >= 15000 & df$lf_discharge < 30000,
  "Very High (>30000 cfs)" = df$lf_discharge >= 30000
)

for (name in names(regimes)) {
  subset <- df[regimes[[name]], ]
  if (nrow(subset) > 0) {
    cat(sprintf("   %s: Mean error=%.1f%%, n=%d\n",
                name, mean(subset$error_pct), nrow(subset)))
  }
}

# ============================================================
# 5. INDEPENDENT USGS API FETCH
# ============================================================
cat("\n", strrep("-", 70), "\n")
cat("5. Independent USGS API spot-check (Jan 2024)\n")
cat(strrep("-", 70), "\n\n")

fetch_usgs <- function(site_id, param_cd, start_dt, end_dt) {
  url <- sprintf(
    "https://waterservices.usgs.gov/nwis/dv/?sites=%s&parameterCd=%s&startDT=%s&endDT=%s&format=json&siteStatus=all",
    site_id, param_cd, start_dt, end_dt
  )
  resp <- GET(url, timeout(60))
  if (status_code(resp) != 200) return(NULL)
  data <- fromJSON(content(resp, "text", encoding = "UTF-8"))
  ts <- data$value$timeSeries
  if (is.null(ts) || length(ts) == 0) return(NULL)
  values <- ts$values[[1]]$value[[1]]
  if (is.null(values)) return(NULL)
  data.frame(
    date = substr(values$dateTime, 1, 10),
    value = as.numeric(values$value),
    stringsAsFactors = FALSE
  )
}

# Fetch Jan 2024 from USGS directly
cat("   Fetching EF stage (01644148) Jan 2024 from USGS API...\n")
ef_api <- fetch_usgs("01644148", "00065", "2024-01-01", "2024-01-31")
Sys.sleep(0.5)

cat("   Fetching LF discharge (01646500) Jan 2024 from USGS API...\n")
lf_api <- fetch_usgs("01646500", "00060", "2024-01-01", "2024-01-31")

if (!is.null(ef_api) && !is.null(lf_api)) {
  # Compare to CSV
  csv_jan <- df %>% filter(date >= "2024-01-01" & date <= "2024-01-31")

  cat(sprintf("   API returned: %d EF, %d LF dates\n", nrow(ef_api), nrow(lf_api)))
  cat(sprintf("   CSV has: %d rows for Jan 2024\n", nrow(csv_jan)))

  # Merge and compare
  api_merged <- merge(ef_api, lf_api, by = "date", suffixes = c("_ef", "_lf"))
  csv_for_check <- csv_jan %>% group_by(date) %>% summarise(
    ef_stage_csv = mean(ef_stage),
    lf_discharge_csv = first(lf_discharge),
    .groups = "drop"
  )

  check <- merge(api_merged, csv_for_check, by = "date")
  if (nrow(check) > 0) {
    ef_diffs <- abs(check$value_ef - check$ef_stage_csv)
    lf_diffs <- abs(check$value_lf - check$lf_discharge_csv)

    cat(sprintf("   Matched dates: %d\n", nrow(check)))
    cat(sprintf("   Max EF diff: %.3f ft\n", max(ef_diffs)))
    cat(sprintf("   Max LF diff: %.1f cfs\n", max(lf_diffs)))

    # Note: EF may have differences because the CSV may contain two series
    # and we're comparing mean vs single API value
    cat(sprintf("   LF exact matches (diff < 1): %d/%d\n",
                sum(lf_diffs < 1), nrow(check)))
  }
} else {
  cat("   API fetch failed — skipping\n")
}

# ============================================================
# SAVE RESULTS
# ============================================================
cat("\n", strrep("=", 70), "\n")
cat("SAVING RESULTS\n")
cat(strrep("=", 70), "\n\n")

results_df <- as.data.frame(results)
write_csv(results_df, file.path(BASE, "verify_results_R.csv"))
cat(sprintf("Saved to: %s/verify_results_R.csv\n", BASE))
cat("\nResults:\n")
print(results_df)
