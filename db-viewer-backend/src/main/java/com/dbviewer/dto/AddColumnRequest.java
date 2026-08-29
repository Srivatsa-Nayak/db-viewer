package com.dbviewer.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Mirrors Go AddColumnRequest */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AddColumnRequest {
    private String tableName;
    private String columnName;
    private String columnType;
    private int length;
    private boolean notNull;
}
