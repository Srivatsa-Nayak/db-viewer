package com.dbviewer.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Mirrors Go UpdateCellRequest */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class UpdateCellRequest {
    private String tableName;
    private String recordId;
    private String columnName;
    private String newValue;
}
