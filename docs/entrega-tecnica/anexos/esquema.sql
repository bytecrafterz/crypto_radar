--
-- PostgreSQL database dump
--

\restrict sPay9nHonUUX6C91EsI8yg3XieV7pGwbH5SSfgWVGCsFLQrsSNjffyX2v9kFy0d

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    level text NOT NULL,
    area text NOT NULL,
    message text NOT NULL,
    data jsonb
);


--
-- Name: activity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_log_id_seq OWNED BY public.activity_log.id;


--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    id bigint NOT NULL,
    token_id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    kind text NOT NULL,
    opportunity numeric(5,1),
    risk numeric(5,1),
    message text NOT NULL,
    sent_ok boolean DEFAULT false NOT NULL,
    error text,
    channels jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alerts_id_seq OWNED BY public.alerts.id;


--
-- Name: api_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_usage (
    day date NOT NULL,
    provider text NOT NULL,
    calls bigint DEFAULT 0 NOT NULL,
    errors bigint DEFAULT 0 NOT NULL,
    rate_hits bigint DEFAULT 0 NOT NULL
);


--
-- Name: deployer_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deployer_reports (
    id bigint NOT NULL,
    token_id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    deployer text,
    deploy_tx text,
    deployed_at timestamp with time zone,
    prior_token_count integer DEFAULT 0 NOT NULL,
    prior_tokens jsonb DEFAULT '[]'::jsonb NOT NULL,
    history_verdict text DEFAULT 'unknown'::text NOT NULL,
    funded_by text,
    note text
);


--
-- Name: deployer_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deployer_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deployer_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deployer_reports_id_seq OWNED BY public.deployer_reports.id;


--
-- Name: holder_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holder_snapshots (
    id bigint NOT NULL,
    token_id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    holders_count integer,
    top10_pct numeric(6,2),
    top20_pct numeric(6,2),
    largest_real_pct numeric(6,2),
    deployer_pct numeric(6,2),
    partial boolean DEFAULT false NOT NULL,
    note text,
    top_holders jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: holder_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.holder_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: holder_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.holder_snapshots_id_seq OWNED BY public.holder_snapshots.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scores (
    id bigint NOT NULL,
    token_id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    opportunity numeric(5,1) NOT NULL,
    risk numeric(5,1) NOT NULL,
    opportunity_label text NOT NULL,
    risk_label text NOT NULL,
    vetoed boolean DEFAULT false NOT NULL,
    opportunity_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    risk_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    missing_data jsonb DEFAULT '[]'::jsonb NOT NULL,
    critical_vetoes jsonb DEFAULT '[]'::jsonb NOT NULL,
    evaluable boolean,
    light text,
    execution jsonb
);


--
-- Name: scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scores_id_seq OWNED BY public.scores.id;


--
-- Name: security_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_changes (
    id bigint NOT NULL,
    token_id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    field text NOT NULL,
    before_val text,
    after_val text,
    severity text DEFAULT 'warn'::text NOT NULL,
    detail text NOT NULL
);


--
-- Name: security_changes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.security_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: security_changes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.security_changes_id_seq OWNED BY public.security_changes.id;


--
-- Name: security_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_reports (
    id bigint NOT NULL,
    token_id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    mint_authority_active boolean,
    mint_authority text,
    freeze_authority_active boolean,
    freeze_authority text,
    is_token_2022 boolean,
    has_extensions boolean,
    owner_can_modify boolean,
    owner_address text,
    has_blacklist boolean,
    has_mint_function boolean,
    is_proxy boolean,
    is_verified boolean,
    buy_tax_pct numeric(6,2),
    sell_tax_pct numeric(6,2),
    tax_modifiable boolean,
    is_honeypot boolean,
    lp_locked_pct numeric(6,2),
    lp_burned_pct numeric(6,2),
    lp_locker_name text,
    total_supply text,
    notes jsonb DEFAULT '[]'::jsonb NOT NULL,
    sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    failed_sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw jsonb,
    can_sell boolean,
    round_trip_loss_pct numeric(8,2)
);


--
-- Name: security_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.security_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: security_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.security_reports_id_seq OWNED BY public.security_reports.id;


--
-- Name: suspicious_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suspicious_events (
    id bigint NOT NULL,
    token_id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    kind text NOT NULL,
    severity text NOT NULL,
    detail text NOT NULL,
    data jsonb
);


--
-- Name: suspicious_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.suspicious_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: suspicious_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.suspicious_events_id_seq OWNED BY public.suspicious_events.id;


--
-- Name: system_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_state (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tg_canales_descubiertos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tg_canales_descubiertos (
    id bigint NOT NULL,
    username text,
    tg_id bigint,
    title text,
    miembros integer,
    lang text,
    descubierto_por text NOT NULL,
    origen_id bigint,
    score integer,
    motivo_score text,
    estado text DEFAULT 'candidato'::text NOT NULL,
    motivo_estado text,
    visto_at timestamp with time zone DEFAULT now() NOT NULL,
    unido_at timestamp with time zone,
    revisado_at timestamp with time zone
);


--
-- Name: tg_canales_descubiertos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tg_canales_descubiertos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tg_canales_descubiertos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tg_canales_descubiertos_id_seq OWNED BY public.tg_canales_descubiertos.id;


--
-- Name: tg_candidatos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tg_candidatos (
    id bigint NOT NULL,
    chain text NOT NULL,
    address text NOT NULL,
    primera_mencion timestamp with time zone NOT NULL,
    fuentes_total integer DEFAULT 1 NOT NULL,
    fuentes_indep integer DEFAULT 1 NOT NULL,
    anticipacion_seg integer,
    score_social integer,
    score_fuentes integer,
    score_evidencia integer,
    score_tecnica integer,
    score_riesgo integer,
    vetado boolean,
    nivel text,
    enviado_at timestamp with time zone,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    detalle jsonb
);


--
-- Name: COLUMN tg_candidatos.detalle; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tg_candidatos.detalle IS '{motivo, explicacion[], contradicciones[], confirmaciones[], resumenes[]}';


--
-- Name: tg_candidatos_historial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tg_candidatos_historial (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    nivel text NOT NULL,
    nivel_antes text,
    score_tecnica integer,
    score_riesgo integer,
    fuentes_indep integer,
    precio_usd numeric(30,15)
);


--
-- Name: tg_candidatos_historial_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tg_candidatos_historial_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tg_candidatos_historial_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tg_candidatos_historial_id_seq OWNED BY public.tg_candidatos_historial.id;


--
-- Name: tg_candidatos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tg_candidatos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tg_candidatos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tg_candidatos_id_seq OWNED BY public.tg_candidatos.id;


--
-- Name: tg_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tg_channels (
    id bigint NOT NULL,
    tg_id bigint NOT NULL,
    username text,
    title text,
    lang text,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    active boolean DEFAULT true NOT NULL,
    notas text,
    ultimo_msg_id bigint DEFAULT 0 NOT NULL,
    leido_at timestamp with time zone,
    via text DEFAULT 'bot'::text NOT NULL
);


--
-- Name: tg_channels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tg_channels_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tg_channels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tg_channels_id_seq OWNED BY public.tg_channels.id;


--
-- Name: tg_mentions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tg_mentions (
    id bigint NOT NULL,
    message_id bigint NOT NULL,
    channel_id bigint NOT NULL,
    chain text,
    address text,
    resuelto_por text,
    tipo_senal text,
    confianza integer,
    posted_at timestamp with time zone NOT NULL,
    es_primera boolean DEFAULT false NOT NULL,
    anticipacion_seg integer,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    anticipacion_veredicto text
);


--
-- Name: COLUMN tg_mentions.anticipacion_veredicto; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tg_mentions.anticipacion_veredicto IS 'se_adelanto | reacciono | sin_movimiento | sin_datos';


--
-- Name: tg_mentions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tg_mentions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tg_mentions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tg_mentions_id_seq OWNED BY public.tg_mentions.id;


--
-- Name: tg_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tg_messages (
    id bigint NOT NULL,
    channel_id bigint NOT NULL,
    tg_msg_id bigint NOT NULL,
    posted_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    text text,
    text_hash text,
    edited_at timestamp with time zone,
    deleted boolean DEFAULT false NOT NULL,
    triage text,
    triage_motivo text,
    triage_at timestamp with time zone,
    clasificacion text,
    clasificacion_motivo text,
    clasificacion_confianza integer,
    clasificado_at timestamp with time zone,
    clasificacion_intentos integer DEFAULT 0 NOT NULL,
    resumen_es text,
    idioma text,
    tipo_senal text,
    afirmaciones jsonb
);


--
-- Name: COLUMN tg_messages.clasificacion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tg_messages.clasificacion IS 'informacion | promocion | hype | indeterminado';


--
-- Name: COLUMN tg_messages.idioma; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tg_messages.idioma IS 'es | pt | en | otro';


--
-- Name: COLUMN tg_messages.afirmaciones; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tg_messages.afirmaciones IS 'Afirmaciones comprobables contra la cadena: liquidez_bloqueada, sin_permisos, sin_impuestos, no_honeypot, advertencia';


--
-- Name: tg_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tg_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tg_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tg_messages_id_seq OWNED BY public.tg_messages.id;


--
-- Name: tg_source_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tg_source_stats (
    channel_id bigint NOT NULL,
    tokens_citados integer DEFAULT 0 NOT NULL,
    veces_primero integer DEFAULT 0 NOT NULL,
    anticipacion_med integer,
    tasa_utiles numeric(5,2),
    tasa_ruido numeric(5,2),
    actualizado timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tg_uniones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tg_uniones (
    id bigint NOT NULL,
    canal_id bigint,
    username text,
    accion text NOT NULL,
    resultado text,
    detalle text,
    ts timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tg_uniones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tg_uniones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tg_uniones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tg_uniones_id_seq OWNED BY public.tg_uniones.id;


--
-- Name: token_horizons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.token_horizons (
    id bigint NOT NULL,
    token_id bigint NOT NULL,
    horizon text NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    minutes_after numeric(10,2),
    price_usd numeric(30,15),
    liquidity_usd numeric(20,2),
    market_cap_usd numeric(20,2),
    holders_count integer,
    price_multiple numeric(12,4),
    cap_multiple numeric(12,4),
    net_multiple numeric(12,4)
);


--
-- Name: token_horizons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.token_horizons_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: token_horizons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.token_horizons_id_seq OWNED BY public.token_horizons.id;


--
-- Name: token_outcomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.token_outcomes (
    token_id bigint NOT NULL,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    hours_tracked numeric(10,2),
    entry_market_cap numeric(20,2),
    peak_market_cap numeric(20,2),
    final_market_cap numeric(20,2),
    peak_multiple numeric(12,4),
    final_multiple numeric(12,4),
    max_drawdown_pct numeric(8,2),
    minutes_to_peak numeric(12,2),
    rugged boolean DEFAULT false NOT NULL,
    rug_reason text,
    outcome text DEFAULT 'neutro'::text NOT NULL,
    score_at_detection numeric(5,1),
    risk_at_detection numeric(5,1)
);


--
-- Name: token_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.token_snapshots (
    id bigint NOT NULL,
    token_id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    price_usd numeric(30,15),
    market_cap_usd numeric(20,2),
    fdv_usd numeric(20,2),
    liquidity_usd numeric(20,2),
    volume_m5 numeric(20,2),
    volume_h1 numeric(20,2),
    volume_h6 numeric(20,2),
    volume_h24 numeric(20,2),
    txns_m5_buys integer,
    txns_m5_sells integer,
    txns_h1_buys integer,
    txns_h1_sells integer,
    txns_h24_buys integer,
    txns_h24_sells integer,
    price_change_m5 numeric(12,4),
    price_change_h1 numeric(12,4),
    price_change_h6 numeric(12,4),
    price_change_h24 numeric(12,4),
    holders_count integer,
    top10_pct numeric(6,2),
    source text
);


--
-- Name: token_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.token_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: token_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.token_snapshots_id_seq OWNED BY public.token_snapshots.id;


--
-- Name: tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tokens (
    id bigint NOT NULL,
    chain text NOT NULL,
    address text NOT NULL,
    pair_address text,
    symbol text,
    name text,
    decimals integer,
    dex text,
    quote_symbol text,
    deployer text,
    pair_created_at timestamp with time zone,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'nuevo'::text NOT NULL,
    discard_reason text,
    website text,
    twitter text,
    telegram text,
    discord text,
    image_url text,
    last_opportunity numeric(5,1),
    last_risk numeric(5,1),
    first_liquidity_usd numeric(20,2),
    first_market_cap_usd numeric(20,2),
    first_price_usd numeric(30,15),
    peak_liquidity_usd numeric(20,2),
    peak_market_cap_usd numeric(20,2),
    peak_price_usd numeric(30,15),
    last_price_usd numeric(30,15),
    last_liquidity_usd numeric(20,2),
    last_market_cap_usd numeric(20,2),
    enriched_at timestamp with time zone,
    alerted_at timestamp with time zone,
    tracked_until timestamp with time zone,
    analysis_started_at timestamp with time zone,
    analysis_finished_at timestamp with time zone,
    first_alert_at timestamp with time zone,
    latency_ms jsonb,
    light text,
    evaluable boolean,
    invalidated_at timestamp with time zone,
    invalidation_reason text
);


--
-- Name: tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tokens_id_seq OWNED BY public.tokens.id;


--
-- Name: wallet_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_activity (
    id bigint NOT NULL,
    chain text NOT NULL,
    wallet text NOT NULL,
    token_id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    role text NOT NULL,
    balance_pct numeric(6,2),
    minutes_after_launch numeric(10,2),
    note text
);


--
-- Name: wallet_activity_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wallet_activity_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wallet_activity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wallet_activity_id_seq OWNED BY public.wallet_activity.id;


--
-- Name: wallet_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_stats (
    chain text NOT NULL,
    wallet text NOT NULL,
    tokens_seen integer DEFAULT 0 NOT NULL,
    tokens_success integer DEFAULT 0 NOT NULL,
    tokens_rugged integer DEFAULT 0 NOT NULL,
    avg_entry_minutes numeric(10,2),
    score numeric(6,2) DEFAULT 0 NOT NULL,
    flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log ALTER COLUMN id SET DEFAULT nextval('public.activity_log_id_seq'::regclass);


--
-- Name: alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts ALTER COLUMN id SET DEFAULT nextval('public.alerts_id_seq'::regclass);


--
-- Name: deployer_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployer_reports ALTER COLUMN id SET DEFAULT nextval('public.deployer_reports_id_seq'::regclass);


--
-- Name: holder_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holder_snapshots ALTER COLUMN id SET DEFAULT nextval('public.holder_snapshots_id_seq'::regclass);


--
-- Name: scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores ALTER COLUMN id SET DEFAULT nextval('public.scores_id_seq'::regclass);


--
-- Name: security_changes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_changes ALTER COLUMN id SET DEFAULT nextval('public.security_changes_id_seq'::regclass);


--
-- Name: security_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_reports ALTER COLUMN id SET DEFAULT nextval('public.security_reports_id_seq'::regclass);


--
-- Name: suspicious_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suspicious_events ALTER COLUMN id SET DEFAULT nextval('public.suspicious_events_id_seq'::regclass);


--
-- Name: tg_canales_descubiertos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_canales_descubiertos ALTER COLUMN id SET DEFAULT nextval('public.tg_canales_descubiertos_id_seq'::regclass);


--
-- Name: tg_candidatos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_candidatos ALTER COLUMN id SET DEFAULT nextval('public.tg_candidatos_id_seq'::regclass);


--
-- Name: tg_candidatos_historial id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_candidatos_historial ALTER COLUMN id SET DEFAULT nextval('public.tg_candidatos_historial_id_seq'::regclass);


--
-- Name: tg_channels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_channels ALTER COLUMN id SET DEFAULT nextval('public.tg_channels_id_seq'::regclass);


--
-- Name: tg_mentions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_mentions ALTER COLUMN id SET DEFAULT nextval('public.tg_mentions_id_seq'::regclass);


--
-- Name: tg_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_messages ALTER COLUMN id SET DEFAULT nextval('public.tg_messages_id_seq'::regclass);


--
-- Name: tg_uniones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_uniones ALTER COLUMN id SET DEFAULT nextval('public.tg_uniones_id_seq'::regclass);


--
-- Name: token_horizons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_horizons ALTER COLUMN id SET DEFAULT nextval('public.token_horizons_id_seq'::regclass);


--
-- Name: token_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_snapshots ALTER COLUMN id SET DEFAULT nextval('public.token_snapshots_id_seq'::regclass);


--
-- Name: tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens ALTER COLUMN id SET DEFAULT nextval('public.tokens_id_seq'::regclass);


--
-- Name: wallet_activity id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_activity ALTER COLUMN id SET DEFAULT nextval('public.wallet_activity_id_seq'::regclass);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: api_usage api_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage
    ADD CONSTRAINT api_usage_pkey PRIMARY KEY (day, provider);


--
-- Name: deployer_reports deployer_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployer_reports
    ADD CONSTRAINT deployer_reports_pkey PRIMARY KEY (id);


--
-- Name: holder_snapshots holder_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holder_snapshots
    ADD CONSTRAINT holder_snapshots_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);


--
-- Name: scores scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_pkey PRIMARY KEY (id);


--
-- Name: security_changes security_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_changes
    ADD CONSTRAINT security_changes_pkey PRIMARY KEY (id);


--
-- Name: security_reports security_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_reports
    ADD CONSTRAINT security_reports_pkey PRIMARY KEY (id);


--
-- Name: suspicious_events suspicious_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suspicious_events
    ADD CONSTRAINT suspicious_events_pkey PRIMARY KEY (id);


--
-- Name: system_state system_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_state
    ADD CONSTRAINT system_state_pkey PRIMARY KEY (key);


--
-- Name: tg_canales_descubiertos tg_canales_descubiertos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_canales_descubiertos
    ADD CONSTRAINT tg_canales_descubiertos_pkey PRIMARY KEY (id);


--
-- Name: tg_canales_descubiertos tg_canales_descubiertos_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_canales_descubiertos
    ADD CONSTRAINT tg_canales_descubiertos_username_key UNIQUE (username);


--
-- Name: tg_candidatos tg_candidatos_chain_address_primera_mencion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_candidatos
    ADD CONSTRAINT tg_candidatos_chain_address_primera_mencion_key UNIQUE (chain, address, primera_mencion);


--
-- Name: tg_candidatos_historial tg_candidatos_historial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_candidatos_historial
    ADD CONSTRAINT tg_candidatos_historial_pkey PRIMARY KEY (id);


--
-- Name: tg_candidatos tg_candidatos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_candidatos
    ADD CONSTRAINT tg_candidatos_pkey PRIMARY KEY (id);


--
-- Name: tg_channels tg_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_channels
    ADD CONSTRAINT tg_channels_pkey PRIMARY KEY (id);


--
-- Name: tg_channels tg_channels_tg_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_channels
    ADD CONSTRAINT tg_channels_tg_id_key UNIQUE (tg_id);


--
-- Name: tg_mentions tg_mentions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_mentions
    ADD CONSTRAINT tg_mentions_pkey PRIMARY KEY (id);


--
-- Name: tg_messages tg_messages_channel_id_tg_msg_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_messages
    ADD CONSTRAINT tg_messages_channel_id_tg_msg_id_key UNIQUE (channel_id, tg_msg_id);


--
-- Name: tg_messages tg_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_messages
    ADD CONSTRAINT tg_messages_pkey PRIMARY KEY (id);


--
-- Name: tg_source_stats tg_source_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_source_stats
    ADD CONSTRAINT tg_source_stats_pkey PRIMARY KEY (channel_id);


--
-- Name: tg_uniones tg_uniones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_uniones
    ADD CONSTRAINT tg_uniones_pkey PRIMARY KEY (id);


--
-- Name: token_horizons token_horizons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_horizons
    ADD CONSTRAINT token_horizons_pkey PRIMARY KEY (id);


--
-- Name: token_horizons token_horizons_token_id_horizon_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_horizons
    ADD CONSTRAINT token_horizons_token_id_horizon_key UNIQUE (token_id, horizon);


--
-- Name: token_outcomes token_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_outcomes
    ADD CONSTRAINT token_outcomes_pkey PRIMARY KEY (token_id);


--
-- Name: token_snapshots token_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_snapshots
    ADD CONSTRAINT token_snapshots_pkey PRIMARY KEY (id);


--
-- Name: tokens tokens_chain_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_chain_address_key UNIQUE (chain, address);


--
-- Name: tokens tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_pkey PRIMARY KEY (id);


--
-- Name: wallet_activity wallet_activity_chain_wallet_token_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_activity
    ADD CONSTRAINT wallet_activity_chain_wallet_token_id_role_key UNIQUE (chain, wallet, token_id, role);


--
-- Name: wallet_activity wallet_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_activity
    ADD CONSTRAINT wallet_activity_pkey PRIMARY KEY (id);


--
-- Name: wallet_stats wallet_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_stats
    ADD CONSTRAINT wallet_stats_pkey PRIMARY KEY (chain, wallet);


--
-- Name: idx_activity_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_ts ON public.activity_log USING btree (ts DESC);


--
-- Name: idx_alerts_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_sent ON public.alerts USING btree (sent_ok, ts DESC);


--
-- Name: idx_alerts_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_token ON public.alerts USING btree (token_id, ts DESC);


--
-- Name: idx_alerts_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_ts ON public.alerts USING btree (ts DESC);


--
-- Name: idx_deployer_addr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deployer_addr ON public.deployer_reports USING btree (deployer);


--
-- Name: idx_deployer_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deployer_token ON public.deployer_reports USING btree (token_id, ts DESC);


--
-- Name: idx_desc_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_desc_estado ON public.tg_canales_descubiertos USING btree (estado, score DESC);


--
-- Name: idx_desc_visto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_desc_visto ON public.tg_canales_descubiertos USING btree (visto_at DESC);


--
-- Name: idx_holders_token_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_holders_token_ts ON public.holder_snapshots USING btree (token_id, ts DESC);


--
-- Name: idx_horizons_h; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_horizons_h ON public.token_horizons USING btree (horizon);


--
-- Name: idx_horizons_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_horizons_token ON public.token_horizons USING btree (token_id);


--
-- Name: idx_outcomes_outcome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outcomes_outcome ON public.token_outcomes USING btree (outcome);


--
-- Name: idx_scores_token_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scores_token_ts ON public.scores USING btree (token_id, ts DESC);


--
-- Name: idx_secchanges_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_secchanges_token ON public.security_changes USING btree (token_id, ts DESC);


--
-- Name: idx_security_cansell; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_cansell ON public.security_reports USING btree (can_sell) WHERE (can_sell IS NOT NULL);


--
-- Name: idx_security_token_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_token_ts ON public.security_reports USING btree (token_id, ts DESC);


--
-- Name: idx_snapshots_token_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snapshots_token_ts ON public.token_snapshots USING btree (token_id, ts DESC);


--
-- Name: idx_snapshots_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snapshots_ts ON public.token_snapshots USING btree (ts DESC);


--
-- Name: idx_susp_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_susp_kind ON public.suspicious_events USING btree (kind, ts DESC);


--
-- Name: idx_susp_token_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_susp_token_ts ON public.suspicious_events USING btree (token_id, ts DESC);


--
-- Name: idx_tg_cand_hist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_cand_hist ON public.tg_candidatos_historial USING btree (candidato_id, ts);


--
-- Name: idx_tg_cand_hist_nivel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_cand_hist_nivel ON public.tg_candidatos_historial USING btree (nivel, ts);


--
-- Name: idx_tg_cand_nivel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_cand_nivel ON public.tg_candidatos USING btree (nivel, creado_at DESC);


--
-- Name: idx_tg_channels_leido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_channels_leido ON public.tg_channels USING btree (leido_at NULLS FIRST);


--
-- Name: idx_tg_men_canal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_men_canal ON public.tg_mentions USING btree (channel_id, posted_at DESC);


--
-- Name: idx_tg_men_pend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_men_pend ON public.tg_mentions USING btree (anticipacion_seg) WHERE (anticipacion_seg IS NULL);


--
-- Name: idx_tg_men_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_men_token ON public.tg_mentions USING btree (chain, address, posted_at);


--
-- Name: idx_tg_mentions_veredicto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_mentions_veredicto ON public.tg_mentions USING btree (anticipacion_veredicto);


--
-- Name: idx_tg_messages_sin_clasificar; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_messages_sin_clasificar ON public.tg_messages USING btree (triage, clasificado_at) WHERE ((triage = 'candidato'::text) AND (clasificado_at IS NULL));


--
-- Name: idx_tg_messages_sin_resumen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_messages_sin_resumen ON public.tg_messages USING btree (posted_at DESC) WHERE ((clasificado_at IS NOT NULL) AND (resumen_es IS NULL));


--
-- Name: idx_tg_msg_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_msg_hash ON public.tg_messages USING btree (text_hash);


--
-- Name: idx_tg_msg_posted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_msg_posted ON public.tg_messages USING btree (posted_at DESC);


--
-- Name: idx_tg_msg_triage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_msg_triage ON public.tg_messages USING btree (triage) WHERE (triage IS NULL);


--
-- Name: idx_tokens_deployer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_deployer ON public.tokens USING btree (chain, deployer) WHERE (deployer IS NOT NULL);


--
-- Name: idx_tokens_first_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_first_seen ON public.tokens USING btree (first_seen DESC);


--
-- Name: idx_tokens_light; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_light ON public.tokens USING btree (light) WHERE (light IS NOT NULL);


--
-- Name: idx_tokens_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_opportunity ON public.tokens USING btree (last_opportunity DESC NULLS LAST);


--
-- Name: idx_tokens_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_status ON public.tokens USING btree (status);


--
-- Name: idx_tokens_tracked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_tracked ON public.tokens USING btree (tracked_until) WHERE (tracked_until IS NOT NULL);


--
-- Name: idx_uniones_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uniones_ts ON public.tg_uniones USING btree (ts DESC);


--
-- Name: idx_wallet_activity_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_activity_token ON public.wallet_activity USING btree (token_id);


--
-- Name: idx_wallet_activity_wallet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_activity_wallet ON public.wallet_activity USING btree (chain, wallet);


--
-- Name: idx_wallet_stats_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_stats_score ON public.wallet_stats USING btree (score DESC);


--
-- Name: alerts alerts_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id) ON DELETE CASCADE;


--
-- Name: deployer_reports deployer_reports_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deployer_reports
    ADD CONSTRAINT deployer_reports_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id) ON DELETE CASCADE;


--
-- Name: holder_snapshots holder_snapshots_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holder_snapshots
    ADD CONSTRAINT holder_snapshots_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id) ON DELETE CASCADE;


--
-- Name: scores scores_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id) ON DELETE CASCADE;


--
-- Name: security_changes security_changes_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_changes
    ADD CONSTRAINT security_changes_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id) ON DELETE CASCADE;


--
-- Name: security_reports security_reports_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_reports
    ADD CONSTRAINT security_reports_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id) ON DELETE CASCADE;


--
-- Name: suspicious_events suspicious_events_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suspicious_events
    ADD CONSTRAINT suspicious_events_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id) ON DELETE CASCADE;


--
-- Name: tg_canales_descubiertos tg_canales_descubiertos_origen_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_canales_descubiertos
    ADD CONSTRAINT tg_canales_descubiertos_origen_id_fkey FOREIGN KEY (origen_id) REFERENCES public.tg_canales_descubiertos(id);


--
-- Name: tg_candidatos_historial tg_candidatos_historial_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_candidatos_historial
    ADD CONSTRAINT tg_candidatos_historial_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.tg_candidatos(id) ON DELETE CASCADE;


--
-- Name: tg_mentions tg_mentions_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_mentions
    ADD CONSTRAINT tg_mentions_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.tg_channels(id) ON DELETE CASCADE;


--
-- Name: tg_mentions tg_mentions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_mentions
    ADD CONSTRAINT tg_mentions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.tg_messages(id) ON DELETE CASCADE;


--
-- Name: tg_messages tg_messages_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_messages
    ADD CONSTRAINT tg_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.tg_channels(id) ON DELETE CASCADE;


--
-- Name: tg_source_stats tg_source_stats_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_source_stats
    ADD CONSTRAINT tg_source_stats_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.tg_channels(id) ON DELETE CASCADE;


--
-- Name: tg_uniones tg_uniones_canal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tg_uniones
    ADD CONSTRAINT tg_uniones_canal_id_fkey FOREIGN KEY (canal_id) REFERENCES public.tg_canales_descubiertos(id) ON DELETE CASCADE;


--
-- Name: token_horizons token_horizons_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_horizons
    ADD CONSTRAINT token_horizons_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id) ON DELETE CASCADE;


--
-- Name: token_outcomes token_outcomes_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_outcomes
    ADD CONSTRAINT token_outcomes_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id) ON DELETE CASCADE;


--
-- Name: token_snapshots token_snapshots_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_snapshots
    ADD CONSTRAINT token_snapshots_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id) ON DELETE CASCADE;


--
-- Name: wallet_activity wallet_activity_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_activity
    ADD CONSTRAINT wallet_activity_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict sPay9nHonUUX6C91EsI8yg3XieV7pGwbH5SSfgWVGCsFLQrsSNjffyX2v9kFy0d

