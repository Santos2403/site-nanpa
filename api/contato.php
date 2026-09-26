<?php
/**
 * POST /api/contato.php
 *
 * Recebe o formulário de contato do site e envia o lead por e-mail.
 * Proteções: método/Content-Type, cabeçalho customizado (CSRF), origem,
 * user-agent, rate limit por IP, honeypot, tempo mínimo de preenchimento,
 * reCAPTCHA v3 (action "contato"), validação/sanitização server-side e
 * bloqueio de envios repetidos.
 *
 * Configuração (mesmo arquivo whatsapp.env usado pelo endpoint do WhatsApp):
 *   RECAPTCHA_SECRET_KEY  — obrigatória para validar o reCAPTCHA
 *   CONTACT_TO            — destino dos leads (padrão: comercial@nanpatec.com.br)
 *   CONTACT_FROM          — remetente técnico (padrão: no-reply@nanpatec.com.br)
 *   ALLOWED_HOSTNAMES     — ex.: nanpatec.com.br,www.nanpatec.com.br
 *
 * Compatível com: PHP 7.4+ | Hostinger Shared Hosting (Apache)
 */

declare(strict_types=1);

$candidatePaths = [
    dirname(__DIR__, 2) . '/env/whatsapp.env',
    dirname(__DIR__, 3) . '/env/whatsapp.env',
    dirname(__DIR__, 1) . '/env/whatsapp.env',
    dirname(__DIR__, 1) . '/../env/whatsapp.env',
    dirname(__DIR__, 1) . '/.env',
    __DIR__ . '/whatsapp.env',
];

foreach ($candidatePaths as $path) {
    if (!is_file($path) || !is_readable($path)) continue;
    $parsed = @parse_ini_file($path, false, INI_SCANNER_RAW);
    if (is_array($parsed)) {
        foreach ($parsed as $k => $v) { $_ENV[$k] = trim((string)$v, " \t\n\r\0\x0B\"'"); }
        break;
    }
    $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines !== false) {
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === ';' || $line[0] === '#') continue;
            $parts = explode('=', $line, 2);
            if (count($parts) === 2) $_ENV[trim($parts[0])] = trim($parts[1], " \t\n\r\0\x0B\"'");
        }
        break;
    }
}

function envValue(string $key, string $default = ''): string
{
    $v = $_ENV[$key] ?? getenv($key);
    return ($v === false || $v === null || $v === '') ? $default : trim((string)$v);
}

define('RECAPTCHA_SECRET_KEY', envValue('RECAPTCHA_SECRET_KEY'));
define('RECAPTCHA_VERIFY_URL', 'https://www.google.com/recaptcha/api/siteverify');
define('RECAPTCHA_ACTION',     'contato');
$minScore = (float)envValue('RECAPTCHA_MIN_SCORE', '0.3');
define('RECAPTCHA_MIN_SCORE',  $minScore > 0 ? $minScore : 0.3);
define('ALLOWED_HOSTNAMES',    envValue('ALLOWED_HOSTNAMES'));
define('CONTACT_TO',           envValue('CONTACT_TO', 'comercial@nanpatec.com.br'));
define('CONTACT_FROM',         envValue('CONTACT_FROM', 'no-reply@nanpatec.com.br'));

define('MIN_FILL_MS', 2500);        // envios mais rápidos que isso são tratados como robô
define('RATE_DIR',  sys_get_temp_dir() . '/nanpa_form_rl');
define('RATE_MAX',  3);             // por minuto
define('RATE_WIN',  60);
define('ABUSE_MAX', 10);            // por 10 minutos
define('ABUSE_WIN', 600);
define('ABUSE_BLK', 1800);
define('DEDUPE_TTL', 600);

const SERVICES = [
    'dutos'        => 'Limpeza robotizada / inspeção de dutos',
    'cpd'          => 'Controlador para CPD / sala técnica',
    'chiller'      => 'Retrofit / automação de chiller',
    'climatizacao' => 'Climatização corporativa',
    'automacao'    => 'Automação HVAC / termostatos',
    'engenharia'   => 'Engenharia e desenvolvimento sob medida',
    'robo'         => 'Aquisição do robô de inspeção de dutos',
    'outro'        => 'Outro assunto',
];

// ---- Helpers ----------------------------------------------------------------

function sendJson(int $status, array $body, array $extraHeaders = []): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('X-Content-Type-Options: nosniff');
    header('X-Robots-Tag: noindex, nofollow');
    foreach ($extraHeaders as $h) { header($h); }
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $status, string $code, array $extra = [], array $headers = []): void
{
    sendJson($status, array_merge(['ok' => false, 'error' => $code], $extra), $headers);
}

function isAllowedOrigin(): bool
{
    $raw = ALLOWED_HOSTNAMES ? explode(',', ALLOWED_HOSTNAMES) : [$_SERVER['HTTP_HOST'] ?? 'localhost'];
    $hosts = [];
    foreach ($raw as $h) {
        $h = preg_replace('/^www\./i', '', strtolower(trim($h)));
        if ($h) $hosts[] = $h;
    }
    $source = $_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '';
    if (!$source) return true; // alguns navegadores omitem por política de privacidade
    $p = parse_url($source);
    if (!$p || empty($p['host'])) return false;
    $host = preg_replace('/^www\./i', '', strtolower($p['host']));
    $local = in_array($host, ['localhost', '127.0.0.1'], true);
    if (strtolower($p['scheme'] ?? '') !== 'https' && !$local) return false;
    return $local || in_array($host, $hosts, true);
}

function rateFile(string $key): string
{
    if (!is_dir(RATE_DIR)) { @mkdir(RATE_DIR, 0700, true); }
    return RATE_DIR . '/' . hash('sha256', $key) . '.json';
}

function checkRateLimit(string $ip): int
{
    $file = rateFile('ip:' . $ip);
    $now  = time();
    $data = ['times' => [], 'blockedUntil' => 0];
    if (is_file($file)) {
        $d = @json_decode((string)@file_get_contents($file), true);
        if (is_array($d)) $data = $d;
    }
    if (($data['blockedUntil'] ?? 0) > $now) return (int)($data['blockedUntil'] - $now);

    $data['times'] = array_values(array_filter($data['times'] ?? [], function ($t) use ($now) { return ($now - $t) < ABUSE_WIN; }));
    $data['times'][] = $now;
    $retry = 0;
    if (count($data['times']) > ABUSE_MAX) {
        $data['blockedUntil'] = $now + ABUSE_BLK;
        $retry = ABUSE_BLK;
    } elseif (count(array_filter($data['times'], function ($t) use ($now) { return ($now - $t) < RATE_WIN; })) > RATE_MAX) {
        $retry = RATE_WIN;
    }
    @file_put_contents($file, json_encode($data), LOCK_EX);
    return $retry;
}

function isDuplicate(string $fingerprint): bool
{
    $file = rateFile('dup:' . $fingerprint);
    if (is_file($file) && (time() - (int)@filemtime($file)) < DEDUPE_TTL) return true;
    @file_put_contents($file, '1', LOCK_EX);
    return false;
}

function cleanOldFiles(): void
{
    if (mt_rand(1, 50) !== 1 || !is_dir(RATE_DIR)) return;
    $cutoff = time() - max(ABUSE_WIN, DEDUPE_TTL) - ABUSE_BLK;
    foreach (glob(RATE_DIR . '/*.json') ?: [] as $f) {
        if (@filemtime($f) < $cutoff) @unlink($f);
    }
}

/** Texto de uma linha: sem tags, sem controle, sem quebras (evita header injection). */
function cleanLine($v, int $max): string
{
    if (!is_string($v)) return '';
    $v = strip_tags($v);
    $v = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $v);
    if (!is_string($v)) return '';
    $v = trim(preg_replace('/\s+/u', ' ', $v) ?? '');
    return function_exists('mb_substr') ? mb_substr($v, 0, $max, 'UTF-8') : substr($v, 0, $max);
}

/** Texto multilinha: mantém quebras de linha, remove tags e caracteres de controle. */
function cleanText($v, int $max): string
{
    if (!is_string($v)) return '';
    $v = str_replace(["\r\n", "\r"], "\n", strip_tags($v));
    $v = preg_replace('/[\x00-\x08\x0B-\x1F\x7F]+/u', '', $v);
    if (!is_string($v)) return '';
    $v = trim(preg_replace("/\n{3,}/", "\n\n", $v) ?? '');
    return function_exists('mb_substr') ? mb_substr($v, 0, $max, 'UTF-8') : substr($v, 0, $max);
}

function strLength(string $v): int
{
    return function_exists('mb_strlen') ? mb_strlen($v, 'UTF-8') : strlen($v);
}

function verifyRecaptcha(string $token, string $ip): array
{
    $post = http_build_query(['secret' => RECAPTCHA_SECRET_KEY, 'response' => $token, 'remoteip' => $ip]);
    $res = false;
    if (function_exists('curl_init')) {
        $ch = curl_init(RECAPTCHA_VERIFY_URL);
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $post, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        ]);
        $res = curl_exec($ch);
        curl_close($ch);
    }
    if ($res === false) {
        $ctx = stream_context_create(['http' => [
            'method' => 'POST', 'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => $post, 'timeout' => 8, 'ignore_errors' => true,
        ]]);
        $res = @file_get_contents(RECAPTCHA_VERIFY_URL, false, $ctx);
    }
    if ($res === false) throw new RuntimeException('siteverify indisponivel');
    $out = @json_decode((string)$res, true);
    if (!is_array($out)) throw new RuntimeException('siteverify resposta invalida');
    return $out;
}

function encodeHeader(string $v): string
{
    return '=?UTF-8?B?' . base64_encode($v) . '?=';
}

// ---- Main -------------------------------------------------------------------

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail(405, 'method_not_allowed', [], ['Allow: POST']);
}
if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'nanpa-form') fail(403, 'forbidden_header');
if (!isAllowedOrigin()) fail(403, 'forbidden_origin');

$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
$bots = '/\b(curl|wget|python-requests|python-urllib|aiohttp|httpx|go-http-client|java\/|okhttp|libwww-perl|scrapy|node-fetch|axios|headlesschrome|phantomjs|puppeteer|playwright|selenium)\b/i';
if (!$ua || preg_match($bots, $ua)) fail(403, 'forbidden_bot');

$ip = $_SERVER['REMOTE_ADDR'] ?? '';
$retryAfter = checkRateLimit($ip);
cleanOldFiles();
if ($retryAfter > 0) fail(429, 'rate_limited', [], ["Retry-After: $retryAfter"]);

if (strpos(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json') === false) fail(415, 'bad_content_type');
$raw = file_get_contents('php://input', false, null, 0, 16385);
if ($raw === false || strlen($raw) > 16384) fail(413, 'bad_payload_size');
$in = @json_decode($raw, true);
if (!is_array($in) || isset($in[0])) fail(400, 'bad_json');

// Honeypot e tempo mínimo: responde "ok" para não ensinar o robô, mas descarta.
$honeypot = isset($in['website']) && is_string($in['website']) ? trim($in['website']) : '';
$elapsed  = isset($in['elapsed_ms']) && is_numeric($in['elapsed_ms']) ? (int)$in['elapsed_ms'] : 0;
if ($honeypot !== '' || $elapsed < MIN_FILL_MS) {
    error_log('nanpa/contato: descartado (honeypot/tempo) ip=' . $ip);
    sendJson(200, ['ok' => true]);
}

// Campos
$name      = cleanLine($in['name'] ?? '', 100);
$company   = cleanLine($in['company'] ?? '', 120);
$phone     = cleanLine($in['phone'] ?? '', 20);
$email     = cleanLine($in['email'] ?? '', 160);
$service   = is_string($in['service'] ?? null) ? $in['service'] : '';
$equipment = cleanLine($in['equipment'] ?? '', 160);
$message   = cleanText($in['message'] ?? '', 2000);
$formId    = cleanLine($in['form_id'] ?? '', 60);

$errors = [];
if (strLength($name) < 2) $errors['name'] = 'Informe seu nome.';
$digits = preg_replace('/\D/', '', $phone);
if (strlen($digits) < 10 || strlen($digits) > 13) $errors['phone'] = 'Informe um telefone com DDD.';
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $errors['email'] = 'Informe um e-mail válido.';
if (!isset(SERVICES[$service])) $errors['service'] = 'Selecione o tipo de serviço.';
if (strLength($message) < 5) $errors['message'] = 'Escreva uma mensagem curta.';
if (preg_match_all('#https?://#i', $message) > 2) $errors['message'] = 'Remova os links da mensagem.';
if ($errors) fail(422, 'validation', ['fields' => $errors]);

// reCAPTCHA v3
if (RECAPTCHA_SECRET_KEY) {
    $token = isset($in['token']) && is_string($in['token']) ? $in['token'] : '';
    if (strlen($token) < 20 || strlen($token) > 8192 || !preg_match('/^[A-Za-z0-9_\-\.]+$/', $token)) {
        fail(403, 'verification_failed');
    }
    try {
        $rc = verifyRecaptcha($token, $ip);
    } catch (Throwable $e) {
        error_log('nanpa/contato: siteverify — ' . $e->getMessage());
        fail(502, 'verification_service_unavailable');
    }
    $score = (float)($rc['score'] ?? 0.0);
    if (empty($rc['success']) || ($rc['action'] ?? '') !== RECAPTCHA_ACTION || $score < RECAPTCHA_MIN_SCORE) {
        error_log('nanpa/contato: recaptcha reprovado score=' . $score . ' action=' . ($rc['action'] ?? ''));
        fail(403, 'verification_failed');
    }
} else {
    error_log('nanpa/contato: RECAPTCHA_SECRET_KEY ausente — envio sem verificação reCAPTCHA');
}

// Envios repetidos (mesmo e-mail + mesma mensagem em 10 min): confirma sem duplicar o e-mail
if (isDuplicate(strtolower($email) . '|' . md5($message))) sendJson(200, ['ok' => true, 'duplicate' => true]);

// Origem do lead
$ref = is_array($in['ref'] ?? null) ? $in['ref'] : [];
$refKeys = ['page' => 'Página do envio', 'landing_page' => 'Página de entrada', 'referrer' => 'Site de origem',
            'utm_source' => 'utm_source', 'utm_medium' => 'utm_medium', 'utm_campaign' => 'utm_campaign',
            'utm_term' => 'utm_term', 'utm_content' => 'utm_content', 'gclid' => 'gclid'];
$refLines = [];
foreach ($refKeys as $k => $label) {
    $v = cleanLine($ref[$k] ?? '', 150);
    if ($v !== '') $refLines[] = $label . ': ' . $v;
}

// E-mail
date_default_timezone_set('America/Sao_Paulo');
$serviceLabel = SERVICES[$service];
$subject = 'Novo contato pelo site — ' . $serviceLabel . ' — ' . $name;

$lines = [
    'Novo contato recebido pelo site nanpatec.com.br',
    '',
    'Nome:        ' . $name,
    'Empresa:     ' . ($company !== '' ? $company : '—'),
    'Telefone:    ' . $phone,
    'E-mail:      ' . $email,
    'Serviço:     ' . $serviceLabel,
    'Equipamento: ' . ($equipment !== '' ? $equipment : '—'),
    '',
    'Mensagem:',
    $message,
    '',
    '--- Origem do lead ---',
    $refLines ? implode("\n", $refLines) : 'Sem parâmetros de campanha (acesso direto ou orgânico).',
    'Formulário:         ' . ($formId !== '' ? $formId : '—'),
    '',
    '--- Técnico ---',
    'Data:               ' . date('d/m/Y H:i:s'),
    'IP:                 ' . $ip,
    'reCAPTCHA:          ' . (RECAPTCHA_SECRET_KEY ? 'verificado' : 'não configurado'),
];
$bodyText = implode("\n", $lines) . "\n";

$fromName = encodeHeader('Site NANPA Tecnologia');
$headers  = implode("\r\n", [
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'From: ' . $fromName . ' <' . CONTACT_FROM . '>',
    'Reply-To: ' . encodeHeader($name) . ' <' . $email . '>',
    'X-Mailer: NANPA-Site',
]);

$sent = @mail(CONTACT_TO, encodeHeader($subject), $bodyText, $headers, '-f' . CONTACT_FROM);
if (!$sent) $sent = @mail(CONTACT_TO, encodeHeader($subject), $bodyText, $headers);

if (!$sent) {
    error_log('nanpa/contato: falha no mail() para ' . CONTACT_TO);
    fail(502, 'mail_failed');
}

// "sent" só existe quando o lead foi de fato enviado (usado para a conversão do Google Ads).
sendJson(200, ['ok' => true, 'sent' => true]);
