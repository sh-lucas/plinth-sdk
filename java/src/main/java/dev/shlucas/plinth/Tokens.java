package dev.shlucas.plinth;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/** Server-side helpers for bring-your-own-auth tokens. Never ship a signing key to a client. */
public final class Tokens {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private Tokens() {}

    public record SigningKey(PrivateKey privateKey, String publicKeyBase64) {}

    /** New Ed25519 key. The public key is the raw 32 bytes in standard base64, as PUT /v1/auth/signing-key expects. */
    public static SigningKey generateSigningKey() {
        try {
            KeyPair pair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
            return new SigningKey(pair.getPrivate(), rawPublicKeyBase64(pair.getPublic()));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String rawPublicKeyBase64(PublicKey key) {
        byte[] der = key.getEncoded(); // X.509 SubjectPublicKeyInfo: 12 byte prefix + 32 raw bytes
        byte[] raw = new byte[32];
        System.arraycopy(der, der.length - 32, raw, 0, 32);
        return Base64.getEncoder().encodeToString(raw);
    }

    /**
     * Sign an EdDSA JWT. {@code access} is {@code {"admin": true}}, {@code {"propose": true}} (proposer) or
     * {@code {"templates": [...], "domains": [...], "backdating"?, "unscoped_bucket_inputs"?, "propose"?}}.
     */
    public static String signGrantToken(PrivateKey privateKey, String kid, String tenant, String issuer,
            String subject, long ttlSeconds, Map<String, Object> access) {
        try {
            long iat = Instant.now().getEpochSecond();
            Map<String, Object> header = new LinkedHashMap<>();
            header.put("alg", "EdDSA");
            header.put("typ", "JWT");
            header.put("kid", kid);
            Map<String, Object> claims = new LinkedHashMap<>();
            claims.put("iss", issuer);
            claims.put("sub", subject);
            claims.put("iat", iat);
            claims.put("exp", iat + ttlSeconds);
            claims.put("plinth", Map.of("tenant", tenant, "access", access));
            String signingInput = b64(MAPPER.writeValueAsBytes(header)) + "." + b64(MAPPER.writeValueAsBytes(claims));
            Signature sig = Signature.getInstance("Ed25519");
            sig.initSign(privateKey);
            sig.update(signingInput.getBytes(StandardCharsets.US_ASCII));
            return signingInput + "." + b64(sig.sign());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String b64(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
