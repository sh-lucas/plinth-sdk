package inventory;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import dev.shlucas.plinth.Models.NewDomain;
import dev.shlucas.plinth.Plinth;
import dev.shlucas.plinth.PlinthException;
import java.security.SecureRandom;
import org.junit.jupiter.api.Test;

class InventoryAppTest {
    @Test
    void sellsFefoAndRejectsOversizedSale() {
        String url = System.getenv("PLINTH_URL");
        assumeTrue(url != null, "PLINTH_URL not set");
        String root = System.getenv().getOrDefault("PLINTH_E2E_ROOT", "sdk-e2e");
        Plinth admin = Plinth.builder().baseUrl(url)
                .credentials(System.getenv("PLINTH_EMAIL"), System.getenv("PLINTH_PASSWORD")).build();

        StringBuilder id = new StringBuilder();
        SecureRandom r = new SecureRandom();
        for (int i = 0; i < 8; i++) id.append(Character.forDigit(r.nextInt(36), 36));
        String runId = id.toString();
        try {
            admin.domains().create(new NewDomain(root, root, "organizational", null, null, null));
        } catch (PlinthException e) {
            assertTrue(e.isConflict());
        }
        String child = root + "-" + runId;
        admin.domains().create(new NewDomain(child, child, "organizational", null, root, null));

        String p = runId + "-";
        InventoryApp.setup(admin, child, p);
        InventoryApp.Result res = InventoryApp.run(admin, p);
        assertEquals(3, res.lotA());
        assertEquals(0, res.lotB());
        assertEquals(600, res.register());
        assertTrue(res.oversizedRejected());
    }
}
