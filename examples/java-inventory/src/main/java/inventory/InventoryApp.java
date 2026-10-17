package inventory;

import dev.shlucas.plinth.ExecuteRequest;
import dev.shlucas.plinth.IdempotencyKeys;
import dev.shlucas.plinth.Models.NewBucket;
import dev.shlucas.plinth.Models.NewDomain;
import dev.shlucas.plinth.Models.NewTemplate;
import dev.shlucas.plinth.Plinth;
import dev.shlucas.plinth.PlinthException;
import java.util.List;
import java.util.Map;

/**
 * Stock intake with provision, FEFO sale with allocate. Part 1 (setup) needs an admin; part 2 is the app flow.
 * Run: PLINTH_URL, PLINTH_EMAIL and PLINTH_PASSWORD set, then {@code ./gradlew run}.
 */
public final class InventoryApp {
    public record Result(long lotA, long lotB, long register, boolean oversizedRejected) {}

    private record Intake(String lot, long expiry, long qty) {}

    private record Sale(long qty, String cash, long price) {}

    /** Admin setup: domains, the cash bucket and the two templates. {@code parent} may be null. */
    static void setup(Plinth admin, String parent, String p) {
        admin.domains().create(new NewDomain(p + "stock", "stock", "stock", "unit", parent, null));
        admin.domains().create(new NewDomain(p + "cash", "cash", "money", "cent", parent, null));
        admin.buckets().create(p + "cash", NewBucket.of(p + "register"));

        List<Map<String, Object>> intake = List.of(
                Map.of("id", "lot", "op", "input", "value_type", "reference"),
                Map.of("id", "expiry", "op", "input", "value_type", "integer", "min", 1),
                Map.of("id", "qty", "op", "input", "value_type", "integer", "min", 1),
                Map.of("id", "opened", "op", "provision", "scope", Map.of("domain_self", true),
                        "reference", Map.of("from", "input", "node", "lot", "on_conflict", "reuse"),
                        "attributes", Map.of("expiry", "expiry")),
                Map.of("id", "in", "op", "post", "bucket", "opened", "amount", "qty", "direction", "in"));
        admin.templates().publish(new NewTemplate(p + "intake", p + "stock", "Stock intake", null, intake));

        List<Map<String, Object>> sell = List.of(
                Map.of("id", "qty", "op", "input", "value_type", "integer", "min", 1),
                Map.of("id", "cash", "op", "input", "value_type", "bucket"),
                Map.of("id", "price", "op", "input", "value_type", "integer", "min", 1),
                Map.of("id", "consume", "op", "allocate", "scope", Map.of("domain_self", true),
                        "order_by", Map.of("by", "attribute", "key", "expiry"), "limit", 5, "amount", "qty",
                        "require", Map.of("code", "INSUFFICIENT_STOCK")),
                Map.of("id", "total", "op", "math", "operator", "mul", "left", "qty", "right", "price"),
                Map.of("id", "cash_in", "op", "post", "bucket", "cash", "amount", "total", "direction", "auto"));
        admin.templates().publish(new NewTemplate(p + "sell", p + "stock", "FEFO sale", null, sell));
    }

    /** App flow: only executes existing templates. */
    static Result run(Plinth app, String p) {
        app.verify(List.of(p + "intake", p + "sell"));
        String stock = p + "stock";
        app.execute(p + "intake", ExecuteRequest.builder().contextDomain(stock)
                .inputs(new Intake(p + "lot-a", 20260201, 4)).idempotencyKey(IdempotencyKeys.of("intake", p, "a")).build());
        app.execute(p + "intake", ExecuteRequest.builder().contextDomain(stock)
                .inputs(new Intake(p + "lot-b", 20260115, 5)).idempotencyKey(IdempotencyKeys.of("intake", p, "b")).build());

        // 6 units: lot b expires first, so it drains first (5), then 1 from lot a.
        app.execute(p + "sell", ExecuteRequest.builder().contextDomain(stock)
                .inputs(new Sale(6, p + "register", 100)).idempotencyKey(IdempotencyKeys.of("sale", p, 1)).build());

        boolean rejected = false;
        try {
            app.execute(p + "sell", ExecuteRequest.builder().contextDomain(stock)
                    .inputs(new Sale(10, p + "register", 100)).idempotencyKey(IdempotencyKeys.of("sale", p, 2)).build());
        } catch (PlinthException e) {
            rejected = e.isRejection("INSUFFICIENT_STOCK");
        }
        return new Result(app.balances().bucket(p + "lot-a").balance(), app.balances().bucket(p + "lot-b").balance(),
                app.balances().bucket(p + "register").balance(), rejected);
    }

    public static void main(String[] args) {
        Plinth admin = Plinth.builder().baseUrl(System.getenv("PLINTH_URL"))
                .credentials(System.getenv("PLINTH_EMAIL"), System.getenv("PLINTH_PASSWORD")).build();
        String p = "inv" + Long.toString(System.currentTimeMillis(), 36) + "-";
        setup(admin, null, p);
        System.out.println(run(admin, p));
    }
}
