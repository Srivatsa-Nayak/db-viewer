package com.dbviewer.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Edits an existing column: rename it, change its type, or change its nullability.
 *
 * <p>Every field except {@code tableName} and {@code columnName} is optional - a null
 * value means "leave this as it is", so the UI can send only what the user actually
 * changed.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class UpdateColumnRequest {
    /** Table that owns the column. */
    private String tableName;

    /** Current column name. */
    private String columnName;

    /** New name, or null/blank to keep the current one. */
    private String newColumnName;

    /** New base type (VARCHAR, INT, ...), or null/blank to keep the current one. */
    private String columnType;

    /** Length for VARCHAR; 0 falls back to 128. */
    private int length;

    /** New nullability, or null to keep the current one. Boxed so "unchanged" is expressible. */
    private Boolean notNull;
}
