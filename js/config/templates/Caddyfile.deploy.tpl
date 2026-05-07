{
	email {{ mustEnv "CADDY_EMAIL" }}
}

(common_proxy) {
	encode zstd gzip

	header {
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		-Server
	}
}

{{ mustEnv "AIRDAY_HOST" }} {
	import common_proxy

	# Health + API + sync WebSocket → Rust server.
	# `reverse_proxy` upgrades WS automatically — no extra match needed
	# for /api/sync.
	@api path /healthz /api/*
	handle @api {
		reverse_proxy 127.0.0.1:8000
	}

	# Web SPA. Bundle origin == API origin so SameSite=Strict cookies
	# stick — do not move the API onto a separate subdomain without
	# revisiting `cookie_same_site` and CORS in the server config.
	handle {
		root * /opt/airday/current/js/web/dist
		try_files {path} /index.html
		file_server
	}
}

www.{{ mustEnv "AIRDAY_HOST" }} {
	redir https://{{ mustEnv "AIRDAY_HOST" }}{uri} 308
}
