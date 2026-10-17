# plinth-sdk (Java)

Java 17+ client for Plinth. Depends on Jackson only. Behaviour follows [`reference/contract.md`](../reference/contract.md).

Install (Gradle): `implementation 'dev.shlucas.plinth:plinth-sdk:0.1.0'`. Build locally with `./gradlew build`, or use `includeBuild('../../java')` as in `examples/java-inventory`.

```java
Plinth plinth = Plinth.builder().baseUrl("https://plinth.sh-lucas.dev").token(jwt).build();
// or .credentials("admin@example.com", "password")
plinth.verify(List.of("credit-points"));                       // at boot
record Amount(long amount) {}
Transaction tx = plinth.execute("credit-points", ExecuteRequest.builder()
        .contextBucket("alice").inputs(new Amount(100))         // or a Map
        .idempotencyKey(IdempotencyKeys.of("order", orderId)).build());
long balance = plinth.balances().bucket("alice").balance();
try { plinth.execute(...); }
catch (PlinthException e) { if (e.isRejection("INSUFFICIENT_POINTS")) { /* guard failed */ } }
plinth.transactions().stream(Map.of("bucket", "alice")).forEach(System.out::println); // all pages
```

Inputs are checked against the template before any request (`PlinthValidationException` lists every problem). Server-side token signing: `Tokens.generateSigningKey()` and `Tokens.signGrantToken(...)`.

Tests need a server: `source .e2e/<port>/env` (see `scripts/local-plinth.sh`), then `./gradlew test`. Without `PLINTH_URL` they skip.
