package dev.shlucas.plinth;

/** A non-2xx response (or a network failure, status 0) from the server. */
public class PlinthException extends RuntimeException {
    private final int status;
    private final String code;
    private final String rejection;
    private final String node;
    private final Integer operation;

    public PlinthException(int status, String code, String message, String rejection, String node, Integer operation) {
        super(message);
        this.status = status;
        this.code = code;
        this.rejection = rejection;
        this.node = node;
        this.operation = operation;
    }

    public PlinthException(int status, String code, String message, Throwable cause) {
        this(status, code, message, null, null, null);
        initCause(cause);
    }

    public int status() { return status; }
    public String code() { return code; }
    /** The guard code of a rejected operation, else null. */
    public String rejection() { return rejection; }
    public String node() { return node; }
    /** Zero-based index of the failed operation in a batch, else null. */
    public Integer operation() { return operation; }

    public boolean isRejection() {
        return status == 422 && "rejected".equals(code);
    }

    public boolean isRejection(String guardCode) {
        return isRejection() && guardCode.equals(rejection);
    }

    public boolean isNotFound() { return status == 404; }
    public boolean isConflict() { return status == 409; }
    public boolean isUnauthorized() { return status == 401; }

    @Override
    public String toString() {
        return "PlinthException[" + status + " " + code + (rejection != null ? " " + rejection : "") + ": "
                + getMessage() + "]";
    }
}
