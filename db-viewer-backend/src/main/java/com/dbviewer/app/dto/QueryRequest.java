package com.dbviewer.app.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Mirrors Go QueryRequest */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class QueryRequest {
    private String query;
}
