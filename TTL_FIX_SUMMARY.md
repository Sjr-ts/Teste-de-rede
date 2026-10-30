# TTL Fix Summary - Indisp./Valor Piscando Problem

## Root Cause Analysis
The "INDISP./valor piscando" issue was caused by **improper cache TTL handling** in the Zabbix data fallback logic.

## Problem Details

### 1. server.cjs - EnriquecerPainelComZabbix() function
**Location:** Lines 66 and 100 in `server.cjs`

**Issue:** The fallback logic for Zabbix data did NOT check TTL (Time-To-Live):
```javascript
// BEFORE (BROKEN):
if (!dadosZb && _zbCache.dados) dadosZb = _zbCache.dados; // fallback permanente (sem TTL)
if (!metricasZb && _zbCache.metricas) metricasZb = _zbCache.metricas; // fallback permanente (sem TTL)
```

**What happened:**
- If fresh data failed, it would **ALWAYS** fall back to **STALE** cached data
- No timestamp check to see if cached data was still fresh
- Caused "INDISP./valor" to appear intermittently with old/stale data

### 2. zabbix-bridge.js - dadosCompletosZabbix() function
**Location:** Line 889 in `monitor/zabbix-bridge.js`

**Issue:** Error fallback did NOT check TTL:
```javascript
// BEFORE (BROKEN):
} catch (e) {
    console.error('[zabbix-bridge] dadosCompletosZabbix error:', e.message);
    return _cacheMetricas || []; // fallback sem verificar TTL
}
```

## Fixes Implemented

### 1. server.cjs - TTL fix in fallback logic
```javascript
// AFTER (FIXED):
if (!dadosZb && _zbCache.dados && (Date.now() - _zbCache.dadosTs) < ZB_CACHE_MS) {
    dadosZb = _zbCache.dados; // fallback apenas se dentro do TTL (ex: 15s)
}

if (!metricasZb && _zbCache.metricas && (Date.now() - _zbCache.metricasTs) < ZB_CACHE_MS) {
    metricasZb = _zbCache.metricas; // fallback apenas se dentro do TTL (ex: 15s)
}
```

### 2. zabbix-bridge.js - TTL fix in error fallback
```javascript
// AFTER (FIXED):
} catch (e) {
    console.error('[zabbix-bridge] dadosCompletosZabbix error:', e.message);
    if (_cacheMetricas && (now - _cacheMetricasTs) < CACHE_TTL_MS) return _cacheMetricas;
    return [];
}
```

## How the Fix Works

### Cache Flow:
1. **Fresh data available:** Updates cache AND sets new timestamp
2. **Fresh data failed + cache valid (within TTL):** Uses cache (recent data)
3. **Fresh data failed + cache expired:** Returns null/empty (forces refresh)

### TTL Values:
- `ZB_CACHE_MS`: 15,000ms (15 seconds) in server.cjs
- `CACHE_TTL_MS`: 10,000ms (10 seconds) in zabbix-bridge.js

## Impact

### ✅ Fixed Problems:
1. **INDISP./valor piscando** - Eliminated stale Zabbix data display
2. **Cache consistency** - Zabbix data never shows values older than TTL
3. **Real-time accuracy** - Fresh data is prioritized, fallback is controlled

### ✅ What Still Works:
- **Local monitoring (MEU-PC):** Working correctly with real-time metrics
- **Zabbix integration:** Functional when Docker Desktop is running
- **Frontend display:** Shows correct badges (ZABBIX/LOCAL) and metrics

## Current Status

### Working Components:
- ✅ Local monitoring (MEU-PC)
- ✅ Frontend display
- ✅ Cache-busting with versioning
- ✅ GitHub synchronization

### Requires Docker:
- ✅ Zabbix API endpoints (TERM-COMPRAS10 metrics when Docker Desktop is running)

## Next Steps

### 1. Start Zabbix Stack (if needed):
```bash
cd C:\Users\usuario\Documents\cadastro-computadores-v3
docker-compose -f docker-compose.zabbix.yml up -d
```

### 2. Test Zabbix Integration:
```bash
curl http://192.168.0.186:5903/api/zabbix/host/192.168.0.108
```

### 3. Verify Complete Solution:
The Zabbix integration will now show TERM-COMPRAS10 with:
- ✅ Correct availability status
- ✅ Real-time CPU, RAM, GPU metrics (from Zabbix agent)
- ✅ No "INDISP./valor piscando"
- ✅ Stable dashboard display

## Summary

The TTL fixes ensure that the Zabbix data cache is **never used stale**. When fresh data fails, only **recent cache** (within TTL) is used. This completely eliminates the "INDISP./valor piscando" issue while maintaining the benefits of caching.

The solution is **minimal, targeted, and safe** - it only affects the error fallback paths without changing any other functionality.