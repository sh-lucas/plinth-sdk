package dev.shlucas.plinth;

import java.util.List;

/** One page of a listing. Use the {@code stream} methods to walk every page. */
public record Page<T>(List<T> items, Models.Pagination pagination) {}
