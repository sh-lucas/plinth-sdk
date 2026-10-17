package dev.shlucas.plinth;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Response and request records. Field names follow the server's snake_case JSON. */
public final class Models {
    private Models() {}

    public record Posting(String bucket, long sequence, long amount) {}

    public record Transaction(
            String id,
            String template,
            String patched,
            @JsonProperty("idempotency_key") String idempotencyKey,
            String memo,
            Map<String, Object> metadata,
            Map<String, Object> inputs,
            Map<String, Object> context,
            @JsonProperty("effective_at") Instant effectiveAt,
            @JsonProperty("created_at") Instant createdAt,
            String actor,
            List<Posting> postings,
            boolean partial) {}

    public record PreviewPosting(String bucket, long amount) {}

    public record PreviewProvision(String bucket, String domain, Map<String, Object> attributes, boolean reused) {}

    /** Result of a preview: what an execution would post and provision. Nothing is stored. */
    public record Preview(List<PreviewPosting> postings, List<PreviewProvision> provisions) {}

    public record BatchPreviewOperation(
            int index, String template, List<PreviewPosting> postings, List<PreviewProvision> provisions) {}

    public record BatchPreview(List<BatchPreviewOperation> operations) {}

    public record Template(
            String id,
            String domain,
            String name,
            String description,
            boolean disabled,
            List<Map<String, Object>> nodes,
            @JsonProperty("created_at") Instant createdAt) {}

    public record Domain(
            String id,
            String parent,
            String name,
            String kind,
            String unit,
            Map<String, Object> metadata,
            @JsonProperty("created_at") Instant createdAt) {}

    public record DomainSubtreeItem(int depth, Domain domain) {}

    public record Bucket(
            String id,
            String domain,
            Map<String, Object> metadata,
            Map<String, Object> attributes,
            @JsonProperty("created_at") Instant createdAt) {}

    public record BucketPosting(
            long sequence,
            String transaction,
            long amount,
            @JsonProperty("running_balance") long runningBalance,
            String memo,
            @JsonProperty("effective_at") Instant effectiveAt,
            @JsonProperty("created_at") Instant createdAt) {}

    public record BucketBalance(String bucket, String domain, String unit, long balance) {}

    public record DomainBalance(String domain, String unit, long balance) {}

    public record BalanceItem(String bucket, String domain, String unit, long balance) {}

    public record ConsolidatedBalance(String unit, long balance) {}

    public record BalanceQueryResult(List<BalanceItem> items, List<ConsolidatedBalance> consolidated) {}

    /** One target of a balance query: set exactly one of bucket or domain. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record BalanceTarget(String bucket, String domain) {
        public static BalanceTarget bucket(String id) {
            return new BalanceTarget(id, null);
        }

        public static BalanceTarget domain(String id) {
            return new BalanceTarget(null, id);
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record NewDomain(
            String id, String name, String kind, String unit, String parent, Map<String, Object> metadata) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record NewBucket(String id, Map<String, Object> metadata, Map<String, Object> attributes) {
        public static NewBucket of(String id) {
            return new NewBucket(id, null, null);
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record NewTemplate(
            String id, String domain, String name, String description, List<Map<String, Object>> nodes) {}

    /** Body of a proposal: new domains and templates. Items have the bodies of the admin create routes. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ProposalRequest(
            String title, String memo, List<NewDomain> domains, List<NewTemplate> templates) {}

    public record Proposal(
            String id,
            String title,
            String memo,
            List<Map<String, Object>> domains,
            List<Map<String, Object>> templates,
            String status,
            @JsonProperty("proposed_by") String proposedBy,
            @JsonProperty("created_at") Instant createdAt,
            @JsonProperty("decided_by") String decidedBy,
            @JsonProperty("decided_at") Instant decidedAt,
            @JsonProperty("decision_memo") String decisionMemo) {}

    public record ProposalValidation(boolean valid) {}

    public record Pagination(
            int page,
            @JsonProperty("per_page") int perPage,
            long total,
            @JsonProperty("has_next") boolean hasNext,
            @JsonProperty("has_previous") boolean hasPrevious) {}

    public record SigningKeyInfo(String kid, @JsonProperty("public_key") String publicKey,
            @JsonProperty("activated_at") Instant activatedAt) {}

    /** One operation of a batch. */
    public record BatchOp(String template, ExecuteRequest request) {}
}
