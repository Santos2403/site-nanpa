<?php
/**
 * POST /api/whatsapp.php
 *
 * Valida o token Cloudflare Turnstile no servidor e so entao devolve
 * o link do WhatsApp. O numero de telefone vive apenas no arquivo .env
 * (fora do document root) ou em variavel de ambiente do servidor.
 *
 * Compativel com: PHP 7.4+ | Hostinger Shared Hosting (Apache)
 */

declare(strict_types=1);

// Carrega arquivo de configuracao fora do document root
// Caminho recomendado no Hostinger: /home/u123456789/env/whatsapp.env
// (um nivel acima do public_html)
$envFile = dirname(__DIR__, 2) . '/env/whatsapp.env';
if (is_file($envFile) && is_readable($envFile)) {
    foreach (parse_ini_file($envFile) as $k => $v) {
        $_ENV[$k] = $v;
    }
}

define('TURNSTILE_SECRET_KEY', $_ENV['TURNSTILE_SECRET_KEY'] ?? getenv('TURNSTILE_SECRET_KEY') ?: '');
define('WHATSAPP_NUMBER',      $_ENV['WHATSAPP_NUMBER']      ?? getenv('WHATSAPP_NUMBER')      ?: '');
define('ALLOWED_HOSTNAMES',    $_ENV['ALLOWED_HOSTNAMES']    ?? getenv('ALLOWED_HOSTNAMES')    ?: '');

define('TURNSTILE_VERIFY_URL', 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
define('TURNSTILE_ACTION',     'whatsapp');
define('DEFAULT_MESSAGE',      'Ola! Vim pelo site da NANPA Tecnologia e gostaria de mais informacoes.');

define('RATE_DIR',  sys_get_temp_dir() . '/nanpa_rl');
define('RATE_MAX',  5);
define('RATE_WIN',  60);
define('ABUSE_MAX', 20);
define('ABUSE_WIN', 600);
define('ABUSE_BLK', 900);

// ---- Helpers ----------------------------------------------------------------

function sendJson(int $status, array $body, array $extraHeaders = []): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('X-Content-Type-Options: nosniff');
    header('X-Robots-Tag: noindex, nofollow');
    header('X-Frame-Options: DENY');
    foreach ($extraHeaders as $h) { header($h); }
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $status, string $code, array $extra = []): void
{
    sendJson($status, ['ok' => false, 'error' => $code], $extra);
}

function getAllowedHosts(): array
{
    $configured = array_filter(array_map('trim', explode(',', ALLOWED_HOSTNAMES)));
    return $configured
        ? array_map('strtolower', $configured)
        : [strtolower($_SERVER['HTTP_HOST'] ?? 'localhost')];
}

function getClientIp(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '';
}

function isAllowedOrigin(array $hosts): bool
{
    $source = $_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '';
    if (!$source) return false;
    $parsed = parse_url($source);
    if (!$parsed || empty($parsed['host'])) return false;
    $host   = strtolower($parsed['host']);
    $scheme = strtolower($parsed['scheme'] ?? '');
    $local  = in_array($host, ['localhost', '127.0.0.1'], true);
    if ($scheme !== 'https' && !$local) return false;
    return in_array($host, $hosts, true);
}

// ---- Rate Limiting (file-based) ---------------------------------------------

function rlFile(string $ip): string
{
    if (!is_dir(RATE_DIR)) { @mkdir(RATE_DIR, 0700, true); }
    return RATE_DIR . '/' . hash('sha256', $ip) . '.json';
}

function checkRateLimit(string $ip): int
{
    $file = rlFile($ip);
    $now  = time();
    $data = ['times' => [], 'blockedUntil' => 0];

    if (is_file($file)) {
        $raw = @file_get_contents($file);
        if ($raw) { $d = @json_decode($raw, true); if (is_array($d)) $data = $d; }
    }

    if (($data['blockedUntil'] ?? 0) > $now) {
        return (int)($data['blockedUntil'] - $now);
    }

    $data['times'] = array_values(array_filter(
        $data['times'] ?? [],
        fn($t) => ($now - $t) < ABUSE_WIN
    ));
    $data['times'][] = $now;

    if (count($data['times']) > ABUSE_MAX) {
        $data['blockedUntil'] = $now + ABUSE_BLK;
        @file_put_contents($file, json_encode($data), LOCK_EX);
        return ABUSE_BLK;
    }

    $recent = count(array_filter($data['times'], fn($t) => ($now - $t) < RATE_WIN));
    if ($recent > RATE_MAX) {
        @file_put_contents($file, json_encode($data), LOCK_EX);
        return RATE_WIN;
    }

    @file_put_contents($file, json_encode($data), LOCK_EX);
    return 0;
}

function cleanOldFiles(): void
{
    if (mt_rand(1, 100) !== 1 || !is_dir(RATE_DIR)) return;
    $cutoff = time() - ABUSE_WIN - 60;
    foreach (glob(RATE_DIR . '/*.json') ?: [] as $f) {
        if (filemtime($f) < $cutoff) @unlink($f);
    }
}

// ---- Turnstile verification -------------------------------------------------

function verifyTurnstile(string $token, string $ip): array
{
    $post = http_build_query([
        'secret'          => TURNSTILE_SECRET_KEY,
        'response'        => $token,
        'remoteip'        => $ip,
        'idempotency_key' => bin2hex(random_bytes(16)),
    ]);

    $ctx = stream_context_create([
        'http' => [
            'method'        => 'POST',
            'header'        => "Content-Type: application/x-www-form-urlencoded\r\nUser-Agent: NANPA-WA-Protect/1.0\r\n",
            'content'       => $post,
            'timeout'       => 8,
            'ignore_errors' => true,
        ],
        'ssl'  => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);

    $res = @file_get_contents(TURNSTILE_VERIFY_URL, false, $ctx);
    if ($res === false) throw new RuntimeException('Falha na conexao com siteverify');
    $result = @json_decode($res, true);
    if (!is_array($result)) throw new RuntimeException('Resposta invalida do siteverify');
    return $result;
}

// ---- Main -------------------------------------------------------------------

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    fail(405, 'method_not_allowed');
}

$phone = preg_replace('/\D/', '', WHATSAPP_NUMBER);
if (!TURNSTILE_SECRET_KEY || !preg_match('/^\d{10,15}$/', $phone)) {
    error_log('nanpa/whatsapp: variaveis de ambiente ausentes');
    fail(503, 'unavailable');
}

$hosts = getAllowedHosts();
if (!isAllowedOrigin($hosts)) fail(403, 'forbidden');

if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'nanpa-wa') fail(403, 'forbidden');

$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
$bots = '/\b(curl|wget|python-requests|python-urllib|aiohttp|httpx|go-http-client|java\/|okhttp|libwww-perl|scrapy|node-fetch|axios|headlesschrome|phantomjs|puppeteer|playwright|selenium)\b/i';
if (!$ua || preg_match($bots, $ua)) fail(403, 'forbidden');

$ip         = getClientIp();
$retryAfter = checkRateLimit($ip);
cleanOldFiles();
if ($retryAfter > 0) fail(429, 'rate_limited', ["Retry-After: $retryAfter"]);

$ct = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
if (strpos($ct, 'application/json') === false) fail(415, 'bad_request');

$raw = file_get_contents('php://input', false, null, 0, 2049);
if ($raw === false || strlen($raw) > 2048) fail(413, 'bad_request');

$body = @json_decode($raw, true);
if (!is_array($body) || isset($body[0])) fail(400, 'bad_request');

$token = isset($body['token']) && is_string($body['token']) ? $body['token'] : '';
if (strlen($token) < 20 || strlen($token) > 2048 || !preg_match('/^[\w.\-:]+$/', $token)) {
    fail(400, 'bad_request');
}

try {
    $outcome = verifyTurnstile($token, $ip);
} catch (Throwable $e) {
    error_log('nanpa/whatsapp: siteverify error — ' . $e->getMessage());
    fail(502, 'verification_unavailable');
}

$validHost = !empty($outcome['hostname'])
    && in_array(strtolower($outcome['hostname']), $hosts, true);

if (empty($outcome['success']) || ($outcome['action'] ?? '') !== TURNSTILE_ACTION || !$validHost) {
    error_log('nanpa/whatsapp: verificacao falhou — ' . json_encode([
        'success'  => $outcome['success']  ?? null,
        'action'   => $outcome['action']   ?? null,
        'hostname' => $outcome['hostname'] ?? null,
        'errors'   => $outcome['error-codes'] ?? [],
    ]));
    fail(403, 'verification_failed');
}

$waUrl = 'https://wa.me/' . $phone . '?text=' . rawurlencode(DEFAULT_MESSAGE);
sendJson(200, ['ok' => true, 'url' => $waUrl]);