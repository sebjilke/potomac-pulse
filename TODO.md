# Potomac Pulse - Deferred Tasks

## Model Improvements

### Fix estimated gauge values not fetching
- Issue with estimated gauge data retrieval
- Priority: Medium

### Fix tributary timing
- Timing calculations for tributaries need adjustment
- Priority: Medium

### Implement Bayesian updating
- Replace simple EMA with Bayesian posterior updates
- Would provide uncertainty quantification and better convergence
- Priority: Low

### Muskingum-Cunge routing
- Implement proper hydrological flow routing
- Would improve travel time predictions during varying flow conditions
- Priority: Low

### Add seasonal stratification
- Separate learning bins by season (spring runoff vs summer baseflow vs winter)
- Different hydraulic behavior in different seasons
- Priority: Low

## Validation & Testing

### Segment-specific travel time validation (spring)
- Validate travel times per river segment during spring conditions
- Need more data during high-flow spring events
- Priority: Medium (seasonal)

### Cross-validation framework
- Build framework for model validation
- Hold-out testing, k-fold cross-validation
- Priority: Low

---

*Last updated: 2026-01-24 (v24)*
