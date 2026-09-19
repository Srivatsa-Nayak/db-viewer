package com.dbviewer.app.importing;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Guesses a column's type from its values — and says how confident it is, and why.
 *
 * <p>Inference on a CSV is guessing: every value is a string, and the only evidence is what the
 * strings look like. Two of those guesses are destructive rather than merely wrong:
 *
 * <ul>
 *   <li>A postcode column of {@code 01234}, {@code 02138} is entirely digits, so the obvious
 *       answer is {@code INT} — and the leading zero is gone the moment the row is stored. The
 *       data is not recoverable from the database afterwards.</li>
 *   <li>A long numeric identifier (a card number, an IMEI, an ISBN-13) overflows a 32-bit integer
 *       and comes back as something else entirely.</li>
 * </ul>
 *
 * <p>Both are detected here and steered to text, but the more important part is
 * {@link Proposal#reason()}: the import is staged in front of the user precisely because no
 * heuristic can be right every time, and a guess the user can see the reasoning for is one they
 * can correct.
 */
public final class ColumnTypeInference {

    /**
     * One column's proposed type, with the evidence behind it.
     *
     * @param name         the column name as it will be created
     * @param inferredType the type this will be created with unless the user changes it
     * @param reason       why that type was chosen, shown beside it in the import dialog
     * @param samples      a few real values, so the user can sanity-check the guess
     * @param nullable     true when at least one row left this column empty
     * @param filled       how many rows carried a value
     */
    public record Proposal(String name, String inferredType, String reason,
                           List<String> samples, boolean nullable, int filled) {
    }

    /** Types offered in the import dialog. Anything else the user types is passed through. */
    public static final List<String> OFFERED_TYPES = List.of(
            "VARCHAR(255)", "TEXT", "INTEGER", "BIGINT", "DECIMAL(15,2)", "REAL",
            "BOOLEAN", "DATE", "DATETIME", "BLOB");

    private static final Pattern INTEGER = Pattern.compile("^[+-]?\\d{1,18}$");
    private static final Pattern DECIMAL = Pattern.compile("^[+-]?(?:\\d+\\.\\d*|\\.\\d+|\\d+)$");
    private static final Pattern ISO_DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern SLASH_DATE = Pattern.compile("^\\d{1,2}/\\d{1,2}/\\d{4}$");
    private static final Pattern TIMESTAMP = Pattern.compile(
            "^\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?Z?$");
    private static final Pattern LEADING_ZERO = Pattern.compile("^[+-]?0\\d+$");

    private static final Set<String> TRUTHY = Set.of("true", "false", "yes", "no", "y", "n", "t", "f");

    /** How many values are shown back to the user per column. */
    private static final int SAMPLE_COUNT = 4;

    /** Enough rows to characterise a column without walking a million of them. */
    private static final int INSPECTION_LIMIT = 2_000;

    private ColumnTypeInference() {
    }

    public static List<Proposal> propose(CsvReader.CsvTable table) {
        List<Proposal> proposals = new ArrayList<>();
        List<String> headers = table.headers();

        for (int column = 0; column < headers.size(); column++) {
            List<String> values = new ArrayList<>();
            int inspected = 0;
            for (List<String> row : table.rows()) {
                if (inspected++ >= INSPECTION_LIMIT) break;
                String value = table.valueAt(row, column);
                values.add(value == null ? "" : value.trim());
            }
            proposals.add(propose(headers.get(column), values));
        }
        return proposals;
    }

    static Proposal propose(String name, List<String> rawValues) {
        List<String> present = rawValues.stream().filter(v -> v != null && !v.isEmpty()).toList();
        boolean nullable = present.size() < rawValues.size();

        Set<String> samples = new LinkedHashSet<>();
        for (String value : present) {
            if (samples.size() >= SAMPLE_COUNT) break;
            samples.add(value.length() > 40 ? value.substring(0, 40) + "…" : value);
        }

        if (present.isEmpty()) {
            return new Proposal(name, "VARCHAR(255)",
                    "Every row is empty, so there is nothing to infer from.",
                    List.copyOf(samples), true, 0);
        }

        boolean allInteger = true;
        boolean allDecimal = true;
        boolean allBoolean = true;
        boolean allIsoDate = true;
        boolean allTimestamp = true;
        boolean anyLeadingZero = false;
        boolean anyOversized = false;
        int longest = 0;

        for (String value : present) {
            longest = Math.max(longest, value.length());
            if (!INTEGER.matcher(value).matches()) {
                allInteger = false;
            } else {
                if (LEADING_ZERO.matcher(value).matches()) anyLeadingZero = true;
                if (value.replaceAll("[+-]", "").length() > 9) anyOversized = true;
            }
            if (!DECIMAL.matcher(value).matches()) allDecimal = false;
            if (!TRUTHY.contains(value.toLowerCase(Locale.ROOT))
                    && !value.equals("0") && !value.equals("1")) {
                allBoolean = false;
            }
            if (!ISO_DATE.matcher(value).matches() && !SLASH_DATE.matcher(value).matches()) {
                allIsoDate = false;
            }
            if (!TIMESTAMP.matcher(value).matches()) allTimestamp = false;
        }

        List<String> sampleList = List.copyOf(samples);

        // Ordered most specific first: a value that looks like a date also looks like text, and
        // a boolean column of 0/1 also looks like an integer.
        if (allInteger && anyLeadingZero) {
            return new Proposal(name, "VARCHAR(" + varcharLength(longest) + ")",
                    "Digits only, but some values have a leading zero (e.g. " + firstLeadingZero(present)
                            + "). A numeric type would drop it permanently.",
                    sampleList, nullable, present.size());
        }
        if (allTimestamp) {
            return new Proposal(name, "DATETIME",
                    "Every value is a date and time.", sampleList, nullable, present.size());
        }
        if (allIsoDate) {
            return new Proposal(name, "DATE",
                    "Every value is a date.", sampleList, nullable, present.size());
        }
        if (allBoolean && !allIsoDate) {
            return new Proposal(name, "BOOLEAN",
                    "Only true/false values appear.", sampleList, nullable, present.size());
        }
        if (allInteger) {
            return anyOversized
                    ? new Proposal(name, "BIGINT",
                            "Whole numbers, some too large for a 32-bit integer.",
                            sampleList, nullable, present.size())
                    : new Proposal(name, "INTEGER",
                            "Every value is a whole number.", sampleList, nullable, present.size());
        }
        if (allDecimal) {
            return new Proposal(name, "DECIMAL(15,2)",
                    "Every value is a number with a decimal part.", sampleList, nullable, present.size());
        }
        if (longest > 255) {
            return new Proposal(name, "TEXT",
                    "Free text, and some values are longer than 255 characters.",
                    sampleList, nullable, present.size());
        }
        return new Proposal(name, "VARCHAR(" + varcharLength(longest) + ")",
                "Mixed text; the longest value is " + longest + " character"
                        + (longest == 1 ? "" : "s") + ".",
                sampleList, nullable, present.size());
    }

    /** Rounds up to a round number, leaving headroom for values the file did not happen to hold. */
    private static int varcharLength(int longest) {
        int[] steps = {32, 64, 128, 255};
        for (int step : steps) {
            if (longest <= step) return step;
        }
        return 255;
    }

    private static String firstLeadingZero(List<String> values) {
        return values.stream().filter(v -> LEADING_ZERO.matcher(v).matches()).findFirst().orElse("0123");
    }
}
