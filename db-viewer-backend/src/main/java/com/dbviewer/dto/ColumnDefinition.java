package com.dbviewer.dto;

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
    private boolean isPk;
    private boolean notNull;
    private String refTable;
    private String refCol;
}
