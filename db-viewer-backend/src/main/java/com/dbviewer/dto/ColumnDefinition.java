package com.dbviewer.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Mirrors Go CreateTable column definition */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ColumnDefinition {
    private String name;
    private String type;
    private int length;

    /**
     * Primary-key flag.
     *
     * <p>The field is named {@code pk} rather than {@code isPk} on purpose. Lombok generates
     * {@code isPk()}/{@code setPk()} for a boolean called {@code isPk}, from which Jackson
     * derives the property name {@code "pk"} - so the {@code "isPk"} the UI sends was silently
     * dropped and every table created through the UI came out without a primary key (and
     * therefore without auto-increment ids). The explicit name plus aliases keep the wire
     * contract stable for every spelling a client might send.
     */
    @JsonProperty("isPk")
    @JsonAlias({"pk", "is_pk"})
    private boolean pk;

    private boolean notNull;
    private String refTable;
    private String refCol;
}
