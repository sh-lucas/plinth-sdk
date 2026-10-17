package dev.shlucas.plinth;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import dev.shlucas.plinth.Models.*;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.Spliterator;
import java.util.Spliterators;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.IntFunction;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.stream.StreamSupport;

/** Plinth client. Build with {@link #builder()}. Thread-safe. */
public final class Plinth {
    private static final Pattern REF = Pattern.compile("^[a-z0-9][a-z0-9._-]{0,63}$");
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};

    private enum Retry { NONE, READ, EXECUTE, EXECUTE_REPLAY }

    static final ObjectMapper MAPPER = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
            .configure(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false);

    private final String baseUrl;
    private final String staticToken;
    private final String email;
    private final String password;
    private final int retries;
    private final boolean validateInputs;
    private final HttpClient http;
    private volatile String sessionToken;
    private final Map<String, Template> templateCache = new ConcurrentHashMap<>();

    private final Balances balances = new Balances();
    private final Transactions transactions = new Transactions();
    private final Templates templates = new Templates();
    private final Domains domains = new Domains();
    private final Buckets buckets = new Buckets();
    private final Proposals proposals = new Proposals();

    private Plinth(Builder b) {
        this.baseUrl = b.baseUrl.replaceAll("/+$", "");
        this.staticToken = b.token;
        this.email = b.email;
        this.password = b.password;
        this.retries = b.retries;
        this.validateInputs = b.validateInputs;
        this.http = b.http != null ? b.http : HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private String baseUrl;
        private String token;
        private String email;
        private String password;
        private int retries = 2;
        private boolean validateInputs = true;
        private HttpClient http;

        public Builder baseUrl(String baseUrl) { this.baseUrl = baseUrl; return this; }
        public Builder token(String token) { this.token = token; return this; }
        public Builder credentials(String email, String password) { this.email = email; this.password = password; return this; }
        public Builder retries(int retries) { this.retries = retries; return this; }
        public Builder validateInputs(boolean validateInputs) { this.validateInputs = validateInputs; return this; }
        public Builder httpClient(HttpClient http) { this.http = http; return this; }

        public Plinth build() {
            if (baseUrl == null || baseUrl.isEmpty()) throw new IllegalStateException("baseUrl is required");
            if (token != null && email != null) throw new IllegalStateException("token and credentials are mutually exclusive");
            return new Plinth(this);
        }
    }

    public Balances balances() { return balances; }
    public Transactions transactions() { return transactions; }
    public Templates templates() { return templates; }
    public Domains domains() { return domains; }
    public Buckets buckets() { return buckets; }
    public Proposals proposals() { return proposals; }

    // ---- operations ----

    /** Execute a template. Retried on network errors and 502/503/504 with replay_on_conflict=true. */
    public Transaction execute(String template, ExecuteRequest request) {
        return execute(template, request, false);
    }

    /** Test hook: {@code replay} sends replay_on_conflict=true on the first attempt. */
    Transaction execute(String template, ExecuteRequest request, boolean replay) {
        Objects.requireNonNull(request.idempotencyKey(), "idempotencyKey");
        validate(template, request.inputs());
        return call("POST", "/transactions/execute/" + enc(template), body(request), Transaction.class,
                replay ? Retry.EXECUTE_REPLAY : Retry.EXECUTE, request.idempotencyKey());
    }

    public Preview preview(String template, ExecuteRequest request) {
        validate(template, request.inputs());
        return call("POST", "/transactions/preview/" + enc(template), body(request), Preview.class, Retry.READ, null);
    }

    /** Execute several operations atomically. Never retried. */
    public List<Transaction> batch(List<BatchOp> operations, String idempotencyKey) {
        Objects.requireNonNull(idempotencyKey, "idempotencyKey");
        Map<String, Object> req = Map.of("operations", batchOps(operations));
        JsonNode node = call("POST", "/transactions/batch", req, JsonNode.class, Retry.NONE, idempotencyKey);
        return MAPPER.convertValue(node.get("transactions"), MAPPER.getTypeFactory().constructCollectionType(List.class, Transaction.class));
    }

    public BatchPreview batchPreview(List<BatchOp> operations) {
        return call("POST", "/transactions/batch/preview", Map.of("operations", batchOps(operations)),
                BatchPreview.class, Retry.READ, null);
    }

    private List<Map<String, Object>> batchOps(List<BatchOp> operations) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (BatchOp op : operations) {
            validate(op.template(), op.request().inputs());
            Map<String, Object> m = body(op.request());
            m.put("template", op.template());
            out.add(m);
        }
        return out;
    }

    /** Check that every template exists and is enabled. Throws one error that lists all failures. Call at boot. */
    public void verify(List<String> templateIds) {
        List<String> problems = new ArrayList<>();
        for (String id : templateIds) {
            try {
                if (templates.get(id).disabled()) problems.add(id + ": disabled");
            } catch (PlinthException e) {
                problems.add(id + (e.isNotFound() ? ": missing" : ": " + e.getMessage()));
            }
        }
        if (!problems.isEmpty()) {
            throw new PlinthException(0, "verify_failed", "templates not usable: " + String.join(", ", problems), null);
        }
    }

    // ---- resources ----

    public final class Balances {
        public BucketBalance bucket(String id) { return bucket(id, null, null); }

        public BucketBalance bucket(String id, String since, String until) {
            return call("GET", range("/buckets/" + enc(id) + "/balance", since, until), null, BucketBalance.class, Retry.READ, null);
        }

        public DomainBalance domain(String id) { return domain(id, null, null); }

        public DomainBalance domain(String id, String since, String until) {
            return call("GET", range("/domains/" + enc(id) + "/balance", since, until), null, DomainBalance.class, Retry.READ, null);
        }

        public BalanceQueryResult query(List<BalanceTarget> targets) { return query(targets, null, null); }

        public BalanceQueryResult query(List<BalanceTarget> targets, String since, String until) {
            Map<String, Object> b = new LinkedHashMap<>();
            b.put("targets", targets);
            if (since != null) b.put("since", since);
            if (until != null) b.put("until", until);
            return call("POST", "/balances/query", b, BalanceQueryResult.class, Retry.READ, null);
        }
    }

    public final class Transactions {
        public Page<Transaction> list(Map<String, Object> filters) {
            return page("/transactions", filters, Transaction.class);
        }

        public Page<Transaction> list() { return list(Map.of()); }

        public Stream<Transaction> stream(Map<String, Object> filters) {
            return streamAll(p -> page("/transactions", withPage(filters, p), Transaction.class));
        }

        public Transaction get(String id) {
            return call("GET", "/transactions/" + enc(id), null, Transaction.class, Retry.READ, null);
        }

        public Transaction byIdempotencyKey(String key) {
            return call("GET", "/transactions/idempotency/" + enc(key), null, Transaction.class, Retry.READ, null);
        }
    }

    public final class Templates {
        public Page<Template> list(Map<String, Object> filters) { return page("/templates", filters, Template.class); }

        public Page<Template> list() { return list(Map.of()); }

        public Stream<Template> stream(Map<String, Object> filters) {
            return streamAll(p -> page("/templates", withPage(filters, p), Template.class));
        }

        public Template get(String id) {
            return call("GET", "/templates/" + enc(id), null, Template.class, Retry.READ, null);
        }

        /** Mermaid flowchart source. */
        public String diagram(String id) {
            return call("GET", "/templates/" + enc(id) + "/diagram", null, String.class, Retry.READ, null);
        }

        /** Admin. Body: a {@link NewTemplate} or a Map. */
        public Template publish(Object body) {
            return call("POST", "/templates", body, Template.class, Retry.NONE, null);
        }

        /** Admin. */
        public Template setDisabled(String id, boolean disabled) {
            return call("PATCH", "/templates/" + enc(id), Map.of("disabled", disabled), Template.class, Retry.NONE, null);
        }
    }

    public final class Domains {
        public Page<Domain> list(Map<String, Object> filters) { return page("/domains", filters, Domain.class); }

        public Stream<Domain> stream(Map<String, Object> filters) {
            return streamAll(p -> page("/domains", withPage(filters, p), Domain.class));
        }

        public Domain get(String id) { return call("GET", "/domains/" + enc(id), null, Domain.class, Retry.READ, null); }

        public Page<Domain> children(String id, Map<String, Object> filters) {
            return page("/domains/" + enc(id) + "/children", filters, Domain.class);
        }

        public Page<DomainSubtreeItem> subtree(String id, Map<String, Object> filters) {
            return page("/domains/" + enc(id) + "/subtree", filters, DomainSubtreeItem.class);
        }

        public Page<Bucket> buckets(String id, Map<String, Object> filters) {
            return page("/domains/" + enc(id) + "/buckets", filters, Bucket.class);
        }

        public Stream<Bucket> streamBuckets(String id, Map<String, Object> filters) {
            return streamAll(p -> page("/domains/" + enc(id) + "/buckets", withPage(filters, p), Bucket.class));
        }

        /** Admin. Body: a {@link NewDomain} or a Map. */
        public Domain create(Object body) { return call("POST", "/domains", body, Domain.class, Retry.NONE, null); }
    }

    public final class Buckets {
        public Bucket get(String id) { return call("GET", "/buckets/" + enc(id), null, Bucket.class, Retry.READ, null); }

        public Page<BucketPosting> postings(String id, Map<String, Object> filters) {
            return page("/buckets/" + enc(id) + "/postings", filters, BucketPosting.class);
        }

        public Stream<BucketPosting> streamPostings(String id, Map<String, Object> filters) {
            return streamAll(p -> page("/buckets/" + enc(id) + "/postings", withPage(filters, p), BucketPosting.class));
        }

        /** Admin. Body: a {@link NewBucket} or a Map. */
        public Bucket create(String domain, Object body) {
            return call("POST", "/domains/" + enc(domain) + "/buckets", body, Bucket.class, Retry.NONE, null);
        }
    }

    public final class Proposals {
        /** Admin or a grant with propose=true. Body: a {@link ProposalRequest} or a Map. */
        public Proposal create(Object body) { return call("POST", "/proposals", body, Proposal.class, Retry.NONE, null); }

        /** Dry run: validates, stores nothing. */
        public ProposalValidation validate(Object body) {
            return call("POST", "/proposals?dry_run=true", body, ProposalValidation.class, Retry.READ, null);
        }

        public Page<Proposal> list(Map<String, Object> filters) { return page("/proposals", filters, Proposal.class); }

        public Stream<Proposal> stream(Map<String, Object> filters) {
            return streamAll(p -> page("/proposals", withPage(filters, p), Proposal.class));
        }

        public Proposal get(String id) { return call("GET", "/proposals/" + enc(id), null, Proposal.class, Retry.READ, null); }

        public Proposal approve(String id, String memo) { return decide(id, "approve", memo); }

        public Proposal reject(String id, String memo) { return decide(id, "reject", memo); }

        private Proposal decide(String id, String verb, String memo) {
            Map<String, Object> q = new LinkedHashMap<>();
            q.put("memo", memo);
            return call("POST", withQuery("/proposals/" + enc(id) + "/" + verb, q), null, Proposal.class, Retry.NONE, null);
        }
    }

    // ---- validation ----

    private Template cachedTemplate(String id) {
        Template t = templateCache.get(id);
        if (t == null) {
            t = templates.get(id);
            templateCache.put(id, t);
        }
        return t;
    }

    private void validate(String template, Object inputs) {
        if (!validateInputs) return;
        Map<String, Object> given = inputs == null ? Map.of() : MAPPER.convertValue(inputs, MAP);
        List<String> problems = new ArrayList<>();
        List<String> known = new ArrayList<>();
        for (Map<String, Object> node : cachedTemplate(template).nodes()) {
            if (!"input".equals(node.get("op"))) continue;
            String id = (String) node.get("id");
            known.add(id);
            if (!given.containsKey(id) || given.get(id) == null) {
                problems.add("missing input '" + id + "'");
                continue;
            }
            Object v = given.get(id);
            String type = String.valueOf(node.get("value_type"));
            if (type.equals("integer")) {
                Long n = asLong(v);
                if (n == null) {
                    problems.add("input '" + id + "' must be an integer");
                    continue;
                }
                if (node.get("min") instanceof Number min && n < min.longValue()) problems.add("input '" + id + "' must be >= " + min);
                if (node.get("max") instanceof Number max && n > max.longValue()) problems.add("input '" + id + "' must be <= " + max);
            } else if (type.equals("bucket") || type.equals("reference")) {
                if (!(v instanceof String s) || !REF.matcher(s).matches()) {
                    problems.add("input '" + id + "' must be a string matching " + REF.pattern());
                }
            }
        }
        for (String key : given.keySet()) {
            if (!known.contains(key)) problems.add("unknown input '" + key + "'");
        }
        if (!problems.isEmpty()) throw new PlinthValidationException(template, problems);
    }

    private static Long asLong(Object v) {
        if (v instanceof Integer || v instanceof Long || v instanceof Short || v instanceof Byte) return ((Number) v).longValue();
        if (v instanceof java.math.BigInteger b && b.bitLength() < 64) return b.longValue();
        return null;
    }

    // ---- http ----

    private static Map<String, Object> body(ExecuteRequest r) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (r.context() != null) m.put("context", r.context());
        m.put("inputs", r.inputs() == null ? Map.of() : r.inputs());
        if (r.effectiveAt() != null) m.put("effective_at", r.effectiveAt().toString());
        if (r.metadata() != null) m.put("metadata", r.metadata());
        if (r.memo() != null) m.put("memo", r.memo());
        return m;
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private static String range(String path, String since, String until) {
        Map<String, Object> q = new LinkedHashMap<>();
        q.put("since", since);
        q.put("until", until);
        return withQuery(path, q);
    }

    private static String withQuery(String path, Map<String, Object> params) {
        StringBuilder sb = new StringBuilder(path);
        char sep = path.contains("?") ? '&' : '?';
        for (Map.Entry<String, Object> e : params.entrySet()) {
            if (e.getValue() == null) continue;
            sb.append(sep).append(enc(e.getKey())).append('=').append(enc(e.getValue().toString()));
            sep = '&';
        }
        return sb.toString();
    }

    private static Map<String, Object> withPage(Map<String, Object> filters, int page) {
        Map<String, Object> m = new LinkedHashMap<>(filters);
        m.put("page", page);
        return m;
    }

    private <T> Page<T> page(String path, Map<String, Object> filters, Class<T> item) {
        JavaType type = MAPPER.getTypeFactory().constructParametricType(Page.class, item);
        return call("GET", withQuery(path, filters), null, type, Retry.READ, null);
    }

    private <T> Stream<T> streamAll(IntFunction<Page<T>> fetch) {
        Iterator<T> it = new Iterator<>() {
            int next = 1;
            Iterator<T> current = List.<T>of().iterator();
            boolean more = true;

            @Override
            public boolean hasNext() {
                while (!current.hasNext() && more) {
                    Page<T> p = fetch.apply(next++);
                    current = p.items().iterator();
                    more = p.pagination() != null && p.pagination().hasNext();
                }
                return current.hasNext();
            }

            @Override
            public T next() {
                if (!hasNext()) throw new NoSuchElementException();
                return current.next();
            }
        };
        return StreamSupport.stream(Spliterators.spliteratorUnknownSize(it, Spliterator.ORDERED), false);
    }

    private <T> T call(String method, String path, Object body, Class<T> type, Retry retry, String idemKey) {
        return call(method, path, body, MAPPER.constructType(type), retry, idemKey);
    }

    @SuppressWarnings("unchecked")
    private <T> T call(String method, String path, Object body, JavaType type, Retry retry, String idemKey) {
        String json;
        try {
            json = body == null ? null : MAPPER.writeValueAsString(body);
        } catch (IOException e) {
            throw new IllegalArgumentException("cannot serialize request body", e);
        }
        boolean relogged = false;
        int attempt = 0;
        while (true) {
            String p = (retry == Retry.EXECUTE_REPLAY || (retry == Retry.EXECUTE && attempt > 0))
                    ? withQuery(path, Map.of("replay_on_conflict", "true")) : path;
            HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(baseUrl + "/v1" + p))
                    .timeout(Duration.ofSeconds(30))
                    .header("Accept", "application/json, text/plain")
                    .method(method, json == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json));
            if (json != null) rb.header("Content-Type", "application/json");
            if (idemKey != null) rb.header("Idempotency-Key", idemKey);
            String auth = authToken();
            if (auth != null) rb.header("Authorization", "Bearer " + auth);

            HttpResponse<String> resp;
            try {
                resp = http.send(rb.build(), HttpResponse.BodyHandlers.ofString());
            } catch (IOException e) {
                if (retry != Retry.NONE && attempt < retries) {
                    backoff(attempt++);
                    continue;
                }
                throw new PlinthException(0, "network", String.valueOf(e.getMessage()), e);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new PlinthException(0, "interrupted", "interrupted", e);
            }
            int status = resp.statusCode();
            if (status == 401 && email != null && !relogged) {
                relogged = true;
                sessionToken = null;
                continue;
            }
            if ((status == 502 || status == 503 || status == 504) && retry != Retry.NONE && attempt < retries) {
                backoff(attempt++);
                continue;
            }
            if (status >= 200 && status < 300) {
                if (type.getRawClass() == String.class) return (T) resp.body();
                try {
                    return MAPPER.readValue(resp.body(), type);
                } catch (IOException e) {
                    throw new PlinthException(status, "bad_response", "cannot parse response: " + e.getMessage(), e);
                }
            }
            throw error(status, resp.body());
        }
    }

    private static PlinthException error(int status, String body) {
        try {
            JsonNode n = MAPPER.readTree(body);
            if (n != null && n.has("message")) {
                return new PlinthException(status, text(n, "code"), n.get("message").asText(), text(n, "rejection"),
                        text(n, "node"), n.hasNonNull("operation") ? n.get("operation").asInt() : null);
            }
        } catch (IOException ignored) {
            // not JSON: fall through
        }
        return new PlinthException(status, "http_" + status, body == null || body.isBlank() ? "HTTP " + status : body,
                null, null, null);
    }

    private static String text(JsonNode n, String field) {
        return n.hasNonNull(field) ? n.get(field).asText() : null;
    }

    private static void backoff(int attempt) {
        long ms = (100L << attempt) + ThreadLocalRandom.current().nextLong(50);
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private String authToken() {
        if (staticToken != null) return staticToken;
        if (email == null) return null;
        String t = sessionToken;
        if (t == null) {
            synchronized (this) {
                t = sessionToken;
                if (t == null) {
                    t = login();
                    sessionToken = t;
                }
            }
        }
        return t;
    }

    private String login() {
        try {
            String json = MAPPER.writeValueAsString(Map.of("email", email, "password", password));
            HttpResponse<String> resp = http.send(HttpRequest.newBuilder(URI.create(baseUrl + "/v1/auth/login"))
                    .timeout(Duration.ofSeconds(30)).header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json)).build(), HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() / 100 != 2) throw error(resp.statusCode(), resp.body());
            return MAPPER.readTree(resp.body()).get("token").asText();
        } catch (IOException e) {
            throw new PlinthException(0, "network", String.valueOf(e.getMessage()), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new PlinthException(0, "interrupted", "interrupted", e);
        }
    }
}
