package dev.shlucas.plinth;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import dev.shlucas.plinth.Models.NewDomain;
import java.security.SecureRandom;
import java.util.List;
import java.util.Map;

/** Shared integration-test fixture: root, per-run child domain, prefixed ids. */
final class E2E {
    static final String URL = System.getenv("PLINTH_URL");
    static final String ROOT = System.getenv().getOrDefault("PLINTH_E2E_ROOT", "sdk-e2e");
    static final boolean LOCAL = "1".equals(System.getenv("PLINTH_E2E_LOCAL"));

    final String runId = runId();
    final String child = ROOT + "-" + runId;
    final Plinth admin;

    private E2E() {
        admin = Plinth.builder().baseUrl(URL)
                .credentials(System.getenv("PLINTH_EMAIL"), System.getenv("PLINTH_PASSWORD")).build();
        try {
            admin.domains().create(new NewDomain(ROOT, ROOT, "organizational", null, null, null));
        } catch (PlinthException e) {
            if (!e.isConflict()) throw e;
        }
        admin.domains().create(new NewDomain(child, child, "organizational", null, ROOT, null));
    }

    static E2E start() {
        assumeTrue(URL != null && System.getenv("PLINTH_EMAIL") != null, "PLINTH_URL / PLINTH_EMAIL not set");
        return new E2E();
    }

    /** Id prefixed with the run id. */
    String id(String name) { return runId + "-" + name; }

    /** Scalar domain under the child, plus the named buckets. */
    String scalarDomain(String name, String unit, String... bucketNames) {
        String d = id(name);
        admin.domains().create(new NewDomain(d, d, "test", unit, child, null));
        for (String b : bucketNames) admin.buckets().create(d, Models.NewBucket.of(id(b)));
        return d;
    }

    /** Template with a context bucket, an integer input "amount" and a credit or guarded debit. */
    void publishWallet(String domain, String credit, String redeem) {
        List<Map<String, Object>> credNodes = List.of(
                Map.of("id", "account", "op", "bucket"),
                Map.of("id", "amount", "op", "input", "value_type", "integer", "min", 1, "max", 1000),
                Map.of("id", "p", "op", "post", "bucket", "account", "amount", "amount", "direction", "in"));
        admin.templates().publish(new Models.NewTemplate(credit, domain, credit, null, credNodes));
        List<Map<String, Object>> redeemNodes = List.of(
                Map.of("id", "account", "op", "bucket"),
                Map.of("id", "amount", "op", "input", "value_type", "integer", "min", 1),
                Map.of("id", "available", "op", "balance", "scope", Map.of("bucket", "account")),
                Map.of("id", "enough", "op", "compare", "operator", "gte", "left", "available", "right", "amount"),
                Map.of("id", "guard", "op", "require", "condition", "enough", "code", "INSUFFICIENT_POINTS"),
                Map.of("id", "p", "op", "post", "bucket", "account", "amount", "amount", "direction", "out"));
        admin.templates().publish(new Models.NewTemplate(redeem, domain, redeem, null, redeemNodes));
    }

    private static String runId() {
        SecureRandom r = new SecureRandom();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 8; i++) sb.append(Character.forDigit(r.nextInt(36), 36));
        return sb.toString();
    }
}
