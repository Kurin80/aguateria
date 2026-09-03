package py.aguateria.field.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "pending_operations")
data class PendingOperationEntity(
    @PrimaryKey val idempotencyKey: String,
    val type: String,
    val payloadJson: String,
    val status: String,
    val photoLocalUri: String?,
    val lastError: String?,
    val createdAt: Long,
    val baseVersion: Int?,
)
