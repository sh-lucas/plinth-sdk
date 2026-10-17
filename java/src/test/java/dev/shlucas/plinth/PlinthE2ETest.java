package dev.shlucas.plinth;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import dev.shlucas.plinth.Models.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PlinthE2ETest {
    E2E e2e;
    Plinth admin;
    String domain;
    String bucket;
    String credit;
    String redeem;

    record Amount(long amount) {}

    @BeforeAll
    void setUp() {
        e2e = E2E.start();
        admin = e2e.admin;
        domain = e2e.scalarDomain("points", "point", "alice", "bob");
        bucket = e2e.id("alice");
        credit = e2e.id("credit");
        redeem = e2e.id("redeem");
        e2e.publishWallet(domain, credit, redeem);
        admin.verify(List.of(credit, redeem));
    }

    ExecuteRequest req(String key, Object inputs) {
        return req(bucket, key, inputs);
    }

    ExecuteRequest req(String b, String key, Object inputs) {
        return ExecuteRequest.builder().contextBucket(b).inputs(inputs).idempotencyKey(key).build();
    }

    @Test
    void executeThenBalanceAndRejection() {
        String bob = e2e.id("bob");
        Transaction tx = admin.execute(credit, req(bob, IdempotencyKeys.of("t", e2e.runId, "credit"), new Amount(100)));
        assertEquals(1, tx.postings().size());
        assertEquals(100, admin.balances().bucket(bob).balance());
        assertEquals(100, admin.balances().bucket(bob).balance());
        BalanceQueryResult q = admin.balances().query(List.of(BalanceTarget.bucket(bob)));
        assertEquals(100, q.items().get(0).balance());
        assertEquals(tx.id(), admin.transactions().byIdempotencyKey(tx.idempotencyKey()).id());

        Preview p = admin.preview(redeem, ExecuteRequest.previewBuilder().contextBucket(bob).inputs(Map.of("amount", 5)).build());
        assertEquals(-5, p.postings().get(0).amount());

        PlinthException ex = assertThrows(PlinthException.class,
                () -> admin.execute(redeem, req(bob, IdempotencyKeys.of("t", e2e.runId, "big"), Map.of("amount", 1000))));
        assertTrue(ex.isRejection());
        assertTrue(ex.isRejection("INSUFFICIENT_POINTS"));
        assertFalse(ex.isRejection("OTHER"));
        assertEquals("guard", ex.node());
        assertEquals(100, admin.balances().bucket(bob).balance());
    }

    @Test
    void idempotentRetryReturnsSameTransaction() {
        String key = IdempotencyKeys.of("t", e2e.runId, "idem");
        Transaction first = admin.execute(credit, req(key, Map.of("amount", 7)));
        PlinthException conflict = assertThrows(PlinthException.class, () -> admin.execute(credit, req(key, Map.of("amount", 7))));
        assertTrue(conflict.isConflict());
        Transaction again = admin.execute(credit, req(key, Map.of("amount", 7)), true);
        assertEquals(first.id(), again.id());
    }

    @Test
    void validationFailsBeforeAnyRequest() {
        PlinthValidationException ex = assertThrows(PlinthValidationException.class,
                () -> admin.execute(credit, req("t:" + e2e.runId + ":bad", Map.of("amount", 5000, "extra", 1))));
        assertEquals(2, ex.problems().size(), ex.getMessage());
        assertThrows(PlinthValidationException.class,
                () -> admin.execute(credit, req("t:" + e2e.runId + ":bad2", Map.of("amount", 1.5))));
        assertThrows(PlinthValidationException.class,
                () -> admin.execute(credit, req("t:" + e2e.runId + ":bad3", Map.of())));
        assertThrows(IllegalStateException.class, () -> ExecuteRequest.builder().build());
        assertTrue(admin.transactions().list(Map.of("template", credit)).items().stream()
                .noneMatch(t -> t.idempotencyKey().contains(":bad")));
    }

    @Test
    void verifyListsEveryProblem() {
        PlinthException ex = assertThrows(PlinthException.class,
                () -> admin.verify(List.of(credit, "nope-one", "nope-two")));
        assertTrue(ex.getMessage().contains("nope-one") && ex.getMessage().contains("nope-two"));
    }

    @Test
    void paginationStreamWalksAllPages() {
        String d = e2e.scalarDomain("paged", "unit", "b1", "b2", "b3", "b4", "b5");
        Page<Bucket> first = admin.domains().buckets(d, Map.of("per_page", 2));
        assertEquals(2, first.items().size());
        assertTrue(first.pagination().hasNext());
        assertEquals(5, first.pagination().total());
        List<String> ids = admin.domains().streamBuckets(d, Map.of("per_page", 2)).map(Bucket::id).collect(Collectors.toList());
        assertEquals(5, ids.size());
        assertEquals(5, ids.stream().distinct().count());
    }

    @Test
    void grantedJwtExecutesOnlyGrantedTemplates() throws Exception {
        assumeTrue(E2E.LOCAL, "needs a local server");
        Tokens.SigningKey key = Tokens.generateSigningKey();
        assertEquals(32, java.util.Base64.getDecoder().decode(key.publicKeyBase64()).length);
        String kid = "k-" + e2e.runId;
        HttpClient http = HttpClient.newHttpClient();
        String login = http.send(HttpRequest.newBuilder(URI.create(E2E.URL + "/v1/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"" + System.getenv("PLINTH_EMAIL")
                        + "\",\"password\":\"" + System.getenv("PLINTH_PASSWORD") + "\"}")).build(),
                HttpResponse.BodyHandlers.ofString()).body();
        String session = Plinth.MAPPER.readTree(login).get("token").asText();
        HttpResponse<String> put = http.send(HttpRequest.newBuilder(URI.create(E2E.URL + "/v1/auth/signing-key"))
                .header("Content-Type", "application/json").header("Authorization", "Bearer " + session)
                .PUT(HttpRequest.BodyPublishers.ofString("{\"kid\":\"" + kid + "\",\"public_key\":\""
                        + key.publicKeyBase64() + "\"}")).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, put.statusCode(), put.body());
        try {
            String jwt = Tokens.signGrantToken(key.privateKey(), kid, "sdk", "e2e", "svc-" + e2e.runId, 300,
                    Map.of("templates", List.of(credit), "domains", List.of(e2e.child)));
            Plinth granted = Plinth.builder().baseUrl(E2E.URL).token(jwt).build();
            Transaction tx = granted.execute(credit, req(IdempotencyKeys.of("t", e2e.runId, "jwt"), Map.of("amount", 3)));
            assertTrue(tx.actor().startsWith("jwt:"));
            PlinthException ex = assertThrows(PlinthException.class,
                    () -> granted.execute(redeem, req(IdempotencyKeys.of("t", e2e.runId, "jwt2"), Map.of("amount", 1))));
            assertTrue(ex.isNotFound());
            Plinth bad = Plinth.builder().baseUrl(E2E.URL).token(jwt + "x").build();
            assertTrue(assertThrows(PlinthException.class, () -> bad.balances().bucket(bucket)).isUnauthorized());
        } finally {
            http.send(HttpRequest.newBuilder(URI.create(E2E.URL + "/v1/auth/signing-key"))
                    .header("Authorization", "Bearer " + session).DELETE().build(), HttpResponse.BodyHandlers.ofString());
        }
    }

    @Test
    void proposalsCreateValidateApproveReject() {
        assumeTrue(E2E.LOCAL, "needs a local server");
        String d = e2e.id("prop");
        String t = e2e.id("prop-credit");
        List<Map<String, Object>> nodes = List.of(
                Map.of("id", "account", "op", "bucket"),
                Map.of("id", "amount", "op", "input", "value_type", "integer", "min", 1),
                Map.of("id", "p", "op", "post", "bucket", "account", "amount", "amount", "direction", "in"));
        ProposalRequest body = new ProposalRequest("Points " + e2e.runId, "memo",
                List.of(new NewDomain(d, d, "points", "point", e2e.child, null)),
                List.of(new NewTemplate(t, d, t, null, nodes)));

        assertTrue(admin.proposals().validate(body).valid());
        assertTrue(admin.proposals().list(Map.of("status", "pending")).items().stream().noneMatch(p -> p.title().equals(body.title())));

        Proposal created = admin.proposals().create(body);
        assertEquals("pending", created.status());
        assertEquals(created.id(), admin.proposals().get(created.id()).id());
        assertTrue(admin.proposals().stream(Map.of("status", "pending")).anyMatch(p -> p.id().equals(created.id())));
        assertTrue(assertThrows(PlinthException.class, () -> admin.templates().get(t)).isNotFound());

        Proposal approved = admin.proposals().approve(created.id(), "ok");
        assertEquals("approved", approved.status());
        assertEquals("ok", approved.decisionMemo());
        assertEquals(t, admin.templates().get(t).id());
        assertTrue(assertThrows(PlinthException.class, () -> admin.proposals().approve(created.id(), null)).isConflict());

        ProposalRequest other = new ProposalRequest("Other " + e2e.runId, null, List.of(),
                List.of(new NewTemplate(e2e.id("prop-two"), d, "two", null, nodes)));
        Proposal p2 = admin.proposals().create(other);
        assertEquals("rejected", admin.proposals().reject(p2.id(), "no").status());
    }
}
