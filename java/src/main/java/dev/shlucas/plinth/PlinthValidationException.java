package dev.shlucas.plinth;

import java.util.List;

/** Inputs do not match the template. No request was made. */
public class PlinthValidationException extends RuntimeException {
    private final List<String> problems;

    public PlinthValidationException(String template, List<String> problems) {
        super("invalid inputs for template '" + template + "': " + String.join("; ", problems));
        this.problems = List.copyOf(problems);
    }

    public List<String> problems() { return problems; }
}
