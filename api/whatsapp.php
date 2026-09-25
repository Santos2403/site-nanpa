<?php
/**
 * POST /api/whatsapp.php
 *
 * Valida o token Google reCAPTCHA v3 no servidor e so entao devolve
 * o link do WhatsApp. O numero de telefone vive apenas no arquivo .env
 * (fora do document root) ou em variavel de ambiente do servidor.
 *
 * Compativel com: PHP 7.4+ | Hostinger Shared Hosting (Apache)
 */

declare(strict_types=1);

// Carrega arquivo de configuracao fora do document root ou em caminhos alternativos
$candidatePaths = [
    dirname(__DIR__, 2) . '/env/whatsapp.env',         // Padrão: /home/user/env/whatsapp.env
    dirname(__DIR__, 3) . '/env/whatsapp.env',         // Em caso de subpasta domains/
    dirname(__DIR__, 1) . '/env/whatsapp.env',         // Se criado dentro de public_html/env/
    dirname(__DIR__, 1) . '/../env/whatsapp.env',
    dirname(__DIR__, 1) . '/.env',
    __DIR__ . '/whatsapp.env',
];

foreach ($candidatePaths as $path) {
    if (is_file($path) && is_readable($path)) {
        // Tenta parse_ini_file
        $parsed = @parse_ini_file($path, false, INI_SCANNER_RAW);
        if ($parsed !== false && is_array($parsed)) {
            foreach ($parsed as $k => $v) {
                $_ENV[$k] = trim((string)$v, " \t\n\r\0\x0B\"'");
            }
            break;
        }
        // Fallback: parse linha a linha caso haja formato não padrão
        $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines !== false) {
            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === ';' || $line[0] === '#') continue;
                $parts = explode('=', $line, 2);
                if (count($parts) === 2) {
                    $_ENV[trim($parts[0])] = trim($parts[1], " \t\n\r\0\x0B\"'");
                }
            }
            break;
        }
    }
}

define('RECAPTCHA_SECRET_KEY', trim($_ENV['RECAPTCHA_SECRET_KEY'] ?? getenv('RECAPTCHA_SECRET_KEY') ?: ''));
define('WHATSAPP_NUMBER',      preg_replace('/\D/', '', (string)($_ENV['WHATSAPP_NUMBER'] ?? getenv('WHATSAPP_NUMBER') ?: '')));
define('ALLOWED_HOSTNAMES',    $_ENV['ALLOWED_HOSTNAMES']    ?? getenv('ALLOWED_HOSTNAMES')    ?: '');

define('RECAPTCHA_VERIFY_URL', 'https://www.google.com/recaptcha/api/siteverify');
// Score mínimo flexível: se definido no .env usa ele, senão 0.3 (evita falso-positivo em domínios novos)
$minScoreConfig = (float)($_ENV['RECAPTCHA_MIN_SCORE'] ?? getenv('RECAPTCHA_MIN_SCORE') ?: 0.3);
define('RECAPTCHA_MIN_SCORE',  $minScoreConfig > 0 ? $minScoreConfig : 0.3);
define('RECAPTCHA_ACTION',     'whatsapp');
define('DEFAULT_MESSAGE',      'Ola! Vim pelo site da NANPA Tecnologia e gostaria de mais informacoes.');

define('RATE_DIR',  sys_get_temp_dir() . '/nanpa_rl');
define('RATE_MAX',  10);
define('RATE_WIN',  60);
define('ABUSE_MAX', 30);
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
    sendJson($status, array_merge(['ok' => false, 'error' => $code], $extra));
}

function getAllowedHosts(): array
{
    $raw = ALLOWED_HOSTNAMES ? explode(',', ALLOWED_HOSTNAMES) : [$_SERVER['HTTP_HOST'] ?? 'localhost'];
    $hosts = [];
    foreach ($raw as $h) {
        $h = strtolower(trim($h));
        if ($h) {
            $hosts[] = $h;
            $clean = preg_replace('/^www\./i', '', $h);
            if ($clean !== $h) $hosts[] = $clean;
            else $hosts[] = 'www.' . $h;
        }
    }
    return array_unique($hosts);
}

function getClientIp(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '';
}

function isAllowedOrigin(array $hosts): bool
{
    $source = $_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '';
    if (!$source) return true; // Permite se o navegador suprimir por política estrita de privacidade
    $parsed = parse_url($source);
    if (!$parsed || empty($parsed['host'])) return true;
    $host   = strtolower($parsed['host']);
    $scheme = strtolower($parsed['scheme'] ?? '');
    $local  = in_array($host, ['localhost', '127.0.0.1'], true);
    if ($scheme !== 'https' && !$local) return false;

    $cleanHost = preg_replace('/^www\./i', '', $host);
    foreach ($hosts as $allowed) {
        $cleanAllowed = preg_replace('/^www\./i', '', strtolower(trim($allowed)));
        if ($cleanHost === $cleanAllowed || $host === strtolower(trim($allowed))) {
            return true;
        }
    }
    return false;
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

// ---- reCAPTCHA v3 verification ---------------------------------------------

function verifyRecaptcha(string $token, string $ip): array
{
    $post = http_build_query([
        'secret'   => RECAPTCHA_SECRET_KEY,
        'response' => $token,
        'remoteip' => $ip,
    ]);

    $res = false;

    // Tenta cURL primeiro (muito mais rápido e confiável no PHP/Apache)
    if (function_exists('curl_init')) {
        $ch = curl_init(RECAPTCHA_VERIFY_URL);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $post,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 8,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_USERAGENT      => 'NANPA-WA-Protect/1.0',
            CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
        ]);
        $res = curl_exec($ch);
        curl_close($ch);
    }

    // Fallback para file_get_contents se cURL não estiver disponível ou falhar
    if ($res === false) {
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
        $res = @file_get_contents(RECAPTCHA_VERIFY_URL, false, $ctx);
    }

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
if (!RECAPTCHA_SECRET_KEY) {
    error_log('nanpa/whatsapp: RECAPTCHA_SECRET_KEY ausente');
    $existing = [];
    foreach ($candidatePaths as $p) {
        if (is_file($p)) $existing[] = $p;
    }
    fail(503, 'missing_secret_key', ['env_found' => !empty($existing), 'locations_checked' => count($candidatePaths)]);
}

if (!preg_match('/^\d{10,15}$/', $phone)) {
    error_log('nanpa/whatsapp: WHATSAPP_NUMBER invalido (' . substr($phone, 0, 4) . '...)');
    fail(503, 'invalid_phone');
}

$hosts = getAllowedHosts();
if (!isAllowedOrigin($hosts)) fail(403, 'forbidden_origin');

if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'nanpa-wa') fail(403, 'forbidden_header');

$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
$bots = '/\b(curl|wget|python-requests|python-urllib|aiohttp|httpx|go-http-client|java\/|okhttp|libwww-perl|scrapy|node-fetch|axios|headlesschrome|phantomjs|puppeteer|playwright|selenium)\b/i';
if (!$ua || preg_match($bots, $ua)) fail(403, 'forbidden_bot');

$ip         = getClientIp();
$retryAfter = checkRateLimit($ip);
cleanOldFiles();
if ($retryAfter > 0) fail(429, 'rate_limited', ["Retry-After: $retryAfter"]);

$ct = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
if (strpos($ct, 'application/json') === false) fail(415, 'bad_content_type');

$raw = file_get_contents('php://input', false, null, 0, 16385);
if ($raw === false || strlen($raw) > 16384) fail(413, 'bad_payload_size');

$body = @json_decode($raw, true);
if (!is_array($body) || isset($body[0])) fail(400, 'bad_json');

// Token reCAPTCHA v3: base64url + ponto separador, pode ter mais de 2KB
$token = isset($body['token']) && is_string($body['token']) ? $body['token'] : '';
if (strlen($token) < 20 || strlen($token) > 8192 || !preg_match('/^[A-Za-z0-9_\-\.]+$/', $token)) {
    fail(400, 'bad_token_format');
}

try {
    $outcome = verifyRecaptcha($token, $ip);
} catch (Throwable $e) {
    error_log('nanpa/whatsapp: siteverify error — ' . $e->getMessage());
    fail(502, 'verification_service_unavailable');
}

// Validacao reCAPTCHA v3: sucesso + score acima do minimo + action correta
$score  = (float)($outcome['score']  ?? 0.0);
$action = (string)($outcome['action'] ?? '');

if (empty($outcome['success']) || $score < RECAPTCHA_MIN_SCORE || $action !== RECAPTCHA_ACTION) {
    error_log('nanpa/whatsapp: recaptcha falhou — ' . json_encode([
        'success' => $outcome['success'] ?? null,
        'score'   => $score,
        'action'  => $action,
        'errors'  => $outcome['error-codes'] ?? [],
    ]));
    fail(403, 'verification_failed', [
        'score'  => $score,
        'action' => $action,
        'google_errors' => $outcome['error-codes'] ?? [],
    ]);
}

$waUrl = 'https://wa.me/' . $phone . '?text=' . rawurlencode(DEFAULT_MESSAGE);
sendJson(200, ['ok' => true, 'url' => $waUrl]);