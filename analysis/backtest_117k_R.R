#!/usr/bin/env Rscript
cat("=== Ceiling/Decay Grid Search — 117k Hourly (R) ===\n")
cat("Started:", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "\n\n")

df <- read.csv("/Users/sebjilke/Desktop/PotomacPulse/analysis/hourly_backtest_data.csv", stringsAsFactors=FALSE)
df$timestamp <- as.POSIXct(df$timestamp, format="%Y-%m-%d %H:%M", tz="UTC")
cat("Loaded:", nrow(df), "rows\n")
cat("Range:", format(min(df$timestamp,na.rm=T)), "to", format(max(df$timestamp,na.rm=T)), "\n")

df$ef_estimate <- ifelse(!is.na(df$water_temp_c) & df$water_temp_c <= 10, 160*df$ef_stage^2.36, 126*df$ef_stage^2.46)
n_cold <- sum(!is.na(df$water_temp_c) & df$water_temp_c <= 10, na.rm=T)
cat("Cold:", n_cold, "Default:", nrow(df)-n_cold, "\n")

tdh <- as.numeric(difftime(df$timestamp[2:nrow(df)], df$timestamp[1:(nrow(df)-1)], units="hours"))
vp <- rep(FALSE, nrow(df)-1)
for(k in seq_along(vp)){
  ip <- k; ic <- k+1
  vp[k] <- !is.na(tdh[k]) & tdh[k]<=2 & tdh[k]>0 & !is.na(df$por_now[ip]) & !is.na(df$por_now[ic]) &
    !is.na(df$por_lagged[ic]) & !is.na(df$ef_stage[ic]) & !is.na(df$lf_discharge[ic]) &
    !is.na(df$travel_time_h[ic]) & !is.na(df$ef_estimate[ic]) & df$travel_time_h[ic]>0
}
cat("Valid pairs:", sum(vp), "\n")

pp <- which(vp); pc <- pp+1
pn_prev <- df$por_now[pp]; pn_curr <- df$por_now[pc]
pl <- df$por_lagged[pc]; efe <- df$ef_estimate[pc]; lfa <- df$lf_discharge[pc]; tth <- df$travel_time_h[pc]
np <- length(pp)

regime <- rep("Steady", np)
regime[pn_curr > pn_prev*1.05] <- "Rising"
regime[pn_curr < pn_prev*0.95] <- "Falling"
cat("Rising:", sum(regime=="Rising"), "Falling:", sum(regime=="Falling"), "Steady:", sum(regime=="Steady"), "\n\n")

w <- ifelse(pl >= 3000, 0.35, 0.0)
base <- (1-w)*pl + w*efe
pcr <- ifelse(pn_prev > 100, pn_curr/pn_prev, 1.0)

DCS <- c(0.30, 0.40, 0.50, 0.60, 0.75)
CRS <- c(NA, 1.05, 1.10, 1.15, 1.20)

res <- data.frame(decay_cap=numeric(), ceiling_ratio=character(), rmse=numeric(), bias=numeric(),
  mape=numeric(), rising_rmse=numeric(), rising_bias=numeric(), falling_rmse=numeric(),
  falling_bias=numeric(), steady_rmse=numeric(), steady_bias=numeric(),
  ceiling_triggers=integer(), n_pairs=integer(), stringsAsFactors=FALSE)

cat(sprintf("%-6s %-6s %10s %10s %8s %10s %10s %10s %8s\n","Decay","Ceil","RMSE","Bias","MAPE%","RiseRMSE","RiseBias","FallRMSE","CeilN"))
cat(paste(rep("-",82),collapse=""),"\n")

for(dc in DCS){
  for(cr in CRS){
    sfrac <- ifelse(tth>0, 1.0/tth, 0.0)
    dfac <- pmin(dc, sqrt(sfrac))
    chg <- (pcr != 1.0)
    ar <- rep(1.0, np)
    ar[chg] <- 1 + (pcr[chg]-1)*dfac[chg]
    corr <- base * ar
    ct <- 0L; final <- corr
    if(!is.na(cr)){
      capp <- (lfa>0); mx <- lfa*cr; hit <- capp & (corr>mx)
      ct <- sum(hit); final[hit] <- mx[hit]
    }
    err <- final - lfa
    ape <- abs(err)/pmax(abs(lfa),1)*100
    rmse <- sqrt(mean(err^2)); bias <- mean(err); mape <- mean(ape)
    calc <- function(m){n<-sum(m); if(n==0) return(list(r=NA,b=NA,n=0L)); e<-err[m]; list(r=sqrt(mean(e^2)),b=mean(e),n=n)}
    ri <- calc(regime=="Rising"); fa <- calc(regime=="Falling"); st <- calc(regime=="Steady")
    cl <- ifelse(is.na(cr),"None",sprintf("%.2f",cr))
    cat(sprintf("%-6.2f %-6s %10.1f %+10.1f %8.1f %10.1f %+10.1f %10.1f %8d\n",
                dc,cl,rmse,bias,mape,ri$r,ri$b,fa$r,ct))
    res <- rbind(res, data.frame(decay_cap=dc, ceiling_ratio=cl, rmse=round(rmse,2), bias=round(bias,2),
      mape=round(mape,2), rising_rmse=round(ri$r,2), rising_bias=round(ri$b,2),
      falling_rmse=round(fa$r,2), falling_bias=round(fa$b,2),
      steady_rmse=round(st$r,2), steady_bias=round(st$b,2),
      ceiling_triggers=ct, n_pairs=np, stringsAsFactors=FALSE))
  }
}

write.csv(res, "/Users/sebjilke/Desktop/PotomacPulse/analysis/backtest_117k_hourly_R.csv", row.names=FALSE)
cat("\nSaved to backtest_117k_hourly_R.csv\n")

bi <- which.min(res$rmse)
cat(sprintf("\nBest RMSE: decay=%.2f, ceil=%s, RMSE=%.1f, Bias=%.1f, RiseBias=%.1f\n",
            res$decay_cap[bi],res$ceiling_ratio[bi],res$rmse[bi],res$bias[bi],res$rising_bias[bi]))
bri <- which.min(res$rising_rmse)
cat(sprintf("Best RiseRMSE: decay=%.2f, ceil=%s, RiseRMSE=%.1f, RiseBias=%.1f\n",
            res$decay_cap[bri],res$ceiling_ratio[bri],res$rising_rmse[bri],res$rising_bias[bri]))
res$arb <- abs(res$rising_bias)
bbi <- which.min(res$arb)
cat(sprintf("Best |RiseBias|: decay=%.2f, ceil=%s, RMSE=%.1f, RiseBias=%.1f\n",
            res$decay_cap[bbi],res$ceiling_ratio[bbi],res$rmse[bbi],res$rising_bias[bbi]))
res$rr <- rank(res$rmse); res$br <- rank(res$arb); res$cr <- 0.5*res$rr+0.5*res$br
bci <- which.min(res$cr)
cat(sprintf("Best combined: decay=%.2f, ceil=%s, RMSE=%.1f, Bias=%.1f, RiseBias=%.1f\n",
            res$decay_cap[bci],res$ceiling_ratio[bci],res$rmse[bci],res$bias[bci],res$rising_bias[bci]))
ci <- which(res$decay_cap==0.50 & res$ceiling_ratio=="1.20")
if(length(ci)==1) cat(sprintf("\nCurrent (0.50/1.20): RMSE=%.1f, Bias=%.1f, RiseBias=%.1f, Triggers=%d\n",
  res$rmse[ci],res$bias[ci],res$rising_bias[ci],res$ceiling_triggers[ci]))
cat("\nFinished:", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "\n=== R COMPLETE ===\n")
