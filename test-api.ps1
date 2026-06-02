$body = @{"url"="https://example.com"} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/start-test" -Method POST -Body $body -ContentType "application/json"
