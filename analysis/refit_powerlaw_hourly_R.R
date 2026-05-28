#!/usr/bin/env Rscript
cat("=== EF Power-Law Refit with Autocorrelation Diagnostics (R) ===\n")
cat("Started:", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "\n\n")

suppressPackageStartupMessages({library(lmtest); library(sandwich); library(nlme)})

df <- read.csv("/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv", stringsAsFactors=FALSE)
cat("Loaded:", nrow(df), "rows\n")

valid <- !is.na(df$ef_stage) & df$ef_stage > 0 & !is.na(df$lf_discharge) & df$lf_discharge > 0
dv <- df[valid,]
cat("Valid (EF>0, LF>0):", nrow(dv), "\n")

cold <- !is.na(dv$water_temp_c) & dv$water_temp_c <= 10
cat("Cold-water:", sum(cold), "Default:", sum(!cold), "Temp-unknown:", sum(is.na(dv$water_temp_c)), "\n\n")

fit_report <- function(log_ef, log_lf, label, n_obs) {
  cat(paste(rep("=",80),collapse=""), "\n")
  cat(sprintf("  %s (n=%d)\n", label, n_obs))
  cat(paste(rep("=",80),collapse=""), "\n\n")
  
  # 1. OLS
  m <- lm(log_lf ~ log_ef)
  s <- summary(m)
  intercept <- coef(m)[1]; slope <- coef(m)[2]
  coef_val <- exp(intercept); exp_val <- slope
  r2 <- s$r.squared
  
  pred <- coef_val * exp(log_ef)^exp_val
  actual <- exp(log_lf)
  resid_real <- pred - actual
  rmse <- sqrt(mean(resid_real^2))
  pct_err <- abs(resid_real)/actual*100
  med_err <- median(pct_err)
  
  ci <- confint(m)
  cat(sprintf("  OLS: LF = %.1f x EF^%.4f\n", coef_val, exp_val))
  cat(sprintf("  R2=%.4f, RMSE=%.1f, Median err=%.1f%%\n", r2, rmse, med_err))
  cat(sprintf("  95%% CI coef: [%.1f, %.1f]\n", exp(ci[1,1]), exp(ci[1,2])))
  cat(sprintf("  95%% CI exp:  [%.4f, %.4f]\n", ci[2,1], ci[2,2]))
  
  # 2. Autocorrelation
  resid <- residuals(m)
  dw <- dwtest(m)$statistic
  cat(sprintf("\n  Durbin-Watson: %.4f\n", dw))
  
  acf_vals <- acf(resid, lag.max=200, plot=FALSE)$acf
  cat("  ACF values:\n")
  for(lag in c(1,2,6,12,24,48,168)){
    if(lag+1 <= length(acf_vals)) cat(sprintf("    lag %3d: %.4f\n", lag, acf_vals[lag+1]))
  }
  
  for(lb_lag in c(1,24,168)){
    if(lb_lag < length(resid)){
      bt <- Box.test(resid, lag=lb_lag, type="Ljung-Box")
      sig <- ifelse(bt$p.value < 0.001, "***", "")
      cat(sprintf("  Ljung-Box(lag=%d): stat=%.1f, p=%.2e %s\n", lb_lag, bt$statistic, bt$p.value, sig))
    }
  }
  
  results <- data.frame(model=label, method="OLS", coef=round(coef_val,2), exp=round(exp_val,4),
    r2=round(r2,4), rmse=round(rmse,1), median_err_pct=round(med_err,1),
    ci_coef_lo=round(exp(ci[1,1]),2), ci_coef_hi=round(exp(ci[1,2]),2),
    ci_exp_lo=round(ci[2,1],4), ci_exp_hi=round(ci[2,2],4),
    n=n_obs, dw=round(dw,4), stringsAsFactors=FALSE)
  
  # 3. Newey-West HAC
  nw <- coeftest(m, vcov=NeweyWest(m, lag=50))
  nw_se <- nw[,2]
  nw_ci_int <- coef(m)[1] + c(-1,1)*1.96*nw_se[1]
  nw_ci_slp <- coef(m)[2] + c(-1,1)*1.96*nw_se[2]
  cat(sprintf("\n  Newey-West HAC (lag=50):\n"))
  cat(sprintf("  Same estimates: coef=%.1f, exp=%.4f\n", coef_val, exp_val))
  cat(sprintf("  HAC 95%% CI coef: [%.1f, %.1f]\n", exp(nw_ci_int[1]), exp(nw_ci_int[2])))
  cat(sprintf("  HAC 95%% CI exp:  [%.4f, %.4f]\n", nw_ci_slp[1], nw_ci_slp[2]))
  
  results <- rbind(results, data.frame(model=label, method="Newey-West HAC",
    coef=round(coef_val,2), exp=round(exp_val,4), r2=round(r2,4), rmse=round(rmse,1),
    median_err_pct=round(med_err,1), ci_coef_lo=round(exp(nw_ci_int[1]),2),
    ci_coef_hi=round(exp(nw_ci_int[2]),2), ci_exp_lo=round(nw_ci_slp[1],4),
    ci_exp_hi=round(nw_ci_slp[2],4), n=n_obs, dw=round(dw,4), stringsAsFactors=FALSE))
  
  # 4. GLS AR(1) via Cochrane-Orcutt
  tryCatch({
    rho <- acf_vals[2]  # lag-1 ACF
    n <- length(log_lf)
    y_co <- log_lf[2:n] - rho * log_lf[1:(n-1)]
    x_co <- log_ef[2:n] - rho * log_ef[1:(n-1)]
    ones_co <- rep(1-rho, n-1)
    gls_m <- lm(y_co ~ 0 + ones_co + x_co)
    gls_int <- coef(gls_m)[1] / (1-rho)
    gls_slp <- coef(gls_m)[2]
    gls_coef <- exp(gls_int)
    gls_exp <- gls_slp
    
    gls_pred <- gls_coef * exp(log_ef)^gls_exp
    gls_resid <- gls_pred - actual
    gls_rmse <- sqrt(mean(gls_resid^2))
    gls_pct <- abs(gls_resid)/actual*100
    gls_med <- median(gls_pct)
    ss_res <- sum((log_lf - (gls_int + gls_slp*log_ef))^2)
    ss_tot <- sum((log_lf - mean(log_lf))^2)
    gls_r2 <- 1 - ss_res/ss_tot
    
    gls_ci <- confint(gls_m)
    gls_ci_int_lo <- gls_ci[1,1]/(1-rho)
    gls_ci_int_hi <- gls_ci[1,2]/(1-rho)
    
    cat(sprintf("\n  GLS Cochrane-Orcutt (rho=%.4f):\n", rho))
    cat(sprintf("  LF = %.1f x EF^%.4f\n", gls_coef, gls_exp))
    cat(sprintf("  R2=%.4f, RMSE=%.1f, Median err=%.1f%%\n", gls_r2, gls_rmse, gls_med))
    cat(sprintf("  CI coef: [%.1f, %.1f]\n", exp(gls_ci_int_lo), exp(gls_ci_int_hi)))
    cat(sprintf("  CI exp:  [%.4f, %.4f]\n", gls_ci[2,1], gls_ci[2,2]))
    
    results <- rbind(results, data.frame(model=label, method="GLS AR(1)",
      coef=round(gls_coef,2), exp=round(gls_exp,4), r2=round(gls_r2,4), rmse=round(gls_rmse,1),
      median_err_pct=round(gls_med,1), ci_coef_lo=round(exp(gls_ci_int_lo),2),
      ci_coef_hi=round(exp(gls_ci_int_hi),2), ci_exp_lo=round(gls_ci[2,1],4),
      ci_exp_hi=round(gls_ci[2,2],4), n=n_obs, dw=round(dw,4), stringsAsFactors=FALSE))
  }, error=function(e) cat(sprintf("\n  GLS AR(1) FAILED: %s\n", e$message)))
  
  # 5. Subsampling
  for(info in list(list(step=24,name="Subsample-24h"), list(step=168,name="Subsample-168h"))){
    idx <- seq(1, length(log_ef), by=info$step)
    if(length(idx) < 10){cat(sprintf("\n  %s: too few (%d), skip\n",info$name,length(idx))); next}
    sub_m <- lm(log_lf[idx] ~ log_ef[idx])
    sub_s <- summary(sub_m)
    sub_coef <- exp(coef(sub_m)[1]); sub_exp <- coef(sub_m)[2]
    sub_r2 <- sub_s$r.squared
    sub_pred <- sub_coef * exp(log_ef[idx])^sub_exp
    sub_act <- exp(log_lf[idx])
    sub_rmse <- sqrt(mean((sub_pred-sub_act)^2))
    sub_pct <- abs(sub_pred-sub_act)/sub_act*100
    sub_ci <- confint(sub_m)
    sub_dw <- dwtest(sub_m)$statistic
    
    cat(sprintf("\n  %s (n=%d):\n", info$name, length(idx)))
    cat(sprintf("  LF = %.1f x EF^%.4f\n", sub_coef, sub_exp))
    cat(sprintf("  R2=%.4f, RMSE=%.1f, Median err=%.1f%%\n", sub_r2, sub_rmse, median(sub_pct)))
    cat(sprintf("  CI coef: [%.1f, %.1f]\n", exp(sub_ci[1,1]), exp(sub_ci[1,2])))
    cat(sprintf("  CI exp:  [%.4f, %.4f]\n", sub_ci[2,1], sub_ci[2,2]))
    cat(sprintf("  DW: %.4f\n", sub_dw))
    
    results <- rbind(results, data.frame(model=label, method=info$name,
      coef=round(sub_coef,2), exp=round(sub_exp,4), r2=round(sub_r2,4),
      rmse=round(sub_rmse,1), median_err_pct=round(median(sub_pct),1),
      ci_coef_lo=round(exp(sub_ci[1,1]),2), ci_coef_hi=round(exp(sub_ci[1,2]),2),
      ci_exp_lo=round(sub_ci[2,1],4), ci_exp_hi=round(sub_ci[2,2],4),
      n=length(idx), dw=round(sub_dw,4), stringsAsFactors=FALSE))
  }
  return(results)
}

# === DEFAULT MODEL ===
log_ef_all <- log(dv$ef_stage)
log_lf_all <- log(dv$lf_discharge)
all_res <- fit_report(log_ef_all, log_lf_all, "Default (all obs)", nrow(dv))

# === COLD WATER MODEL ===
dv_cold <- dv[cold,]
if(nrow(dv_cold) > 100){
  log_ef_c <- log(dv_cold$ef_stage)
  log_lf_c <- log(dv_cold$lf_discharge)
  all_res <- rbind(all_res, fit_report(log_ef_c, log_lf_c, "Cold water (<=10C)", nrow(dv_cold)))
}

cat(sprintf("\n%s\nCOMPARISON WITH v29.0\n%s\n", paste(rep("=",80),collapse=""), paste(rep("=",80),collapse="")))
cat("  v29.0 Default: LF = 126 x EF^2.46 (R2=0.91)\n")
cat("  v29.0 Cold:    LF = 160 x EF^2.36 (R2=0.96)\n\n")

cat("SUMMARY TABLE:\n")
print(all_res[,c("model","method","coef","exp","r2","rmse","n","dw","ci_exp_lo","ci_exp_hi")])

write.csv(all_res, "/Users/sebjilke/Desktop/PotomacPulse/analysis/powerlaw_refit_R.csv", row.names=FALSE)
cat("\nSaved to powerlaw_refit_R.csv\n")
cat("Finished:", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "\n=== R COMPLETE ===\n")
