# Cross-version backend compatibility — BLOCKED

The earlier static old/new client selector and local provider-name schema checks passed on `release/nearr-1.5-production-compat`, but no single dynamic command exercises exact public 1.4.55 and build 58 requests against the same candidate backend. No live authenticated old-client or 1.5 Production smoke, real V2 duplicate transfer, or physical upgrade test has passed. These remain hard gates; static checks must not be reported as full client compatibility.
