package com.dbviewer.app.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Mirrors Go DeleteRowRequest */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DeleteRowRequest {
    private String tableName;
    private String recordId;
}
